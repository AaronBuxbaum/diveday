import type Anthropic from "@anthropic-ai/sdk";
import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { StructuredCall } from "@/lib/claude/structured";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { fakeClaude, fakeClaudeMessage } from "@/test/fakes";
import { anonymizeDiver } from "./anonymize";
import { runAssist } from "./assists";
import { claudeCallContent, claudeUsage, people, personRoles, shops } from "./schema";

/**
 * `claude_call_content`: what each Claude call said, kept 30 days (Aaron,
 * 2026-10-23). The 30-day prune itself is the generic window case in
 * `retention.test.ts`; this file is the write path and the erasure.
 */
const ctx = fileScopedShopContext();

beforeEach(async () => {
  await ctx.db.update(shops).set({ isDemo: false }).where(eq(shops.id, ctx.shop.id));
});

const Card = z.object({ number: z.string() });
const keyed = { ANTHROPIC_API_KEY: "test-anthropic-key" };
const now = new Date("2026-10-23T12:00:00.000Z");

/** About 812 KB of base64 whose every run is a marker a leak would carry. */
const IMAGE_DATA = "QUJD".repeat(270_667);

function cardCall(content: StructuredCall<typeof Card>["content"]): StructuredCall<typeof Card> {
  return {
    model: "quick",
    system: "Read the card number.",
    context: "Shop: Blue Mantis.",
    content,
    schema: Card,
  };
}

function answering(number: string) {
  return fakeClaude({
    reply: () =>
      fakeClaudeMessage({ text: JSON.stringify({ number }), requestId: "req_011CContent" }),
  });
}

async function contentRows(shopId: string) {
  return ctx.db.select().from(claudeCallContent).where(eq(claudeCallContent.shopId, shopId));
}

describe("runAssist keeps what the call said", () => {
  it("writes one row beside the usage row, with the instructions, context, message and answer", async () => {
    const value = await runAssist(ctx.db, {
      shopId: ctx.shop.id,
      feature: "cert_scan",
      call: cardCall("Card number 12345, please."),
      provider: answering("12345"),
      env: keyed,
      now,
    });
    expect(value).toEqual({ number: "12345" });

    const [usage] = await ctx.db
      .select()
      .from(claudeUsage)
      .where(eq(claudeUsage.shopId, ctx.shop.id));
    const rows = await contentRows(ctx.shop.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      usageId: usage?.id,
      systemText: "Read the card number.",
      contextText: "Shop: Blue Mantis.",
      contentText: "Card number 12345, please.",
      answerText: JSON.stringify({ number: "12345" }),
      fetchedUrls: null,
      createdAt: now,
    });
  });

  it("records how long the call took and Anthropic's request id on the usage row", async () => {
    const ticks = [5_000, 5_412];
    const clock = vi.spyOn(performance, "now").mockImplementation(() => ticks.shift() ?? 5_412);
    try {
      await runAssist(ctx.db, {
        shopId: ctx.shop.id,
        feature: "cert_scan",
        call: cardCall("12345"),
        provider: answering("12345"),
        env: keyed,
        now,
      });
    } finally {
      clock.mockRestore();
    }
    const [usage] = await ctx.db
      .select()
      .from(claudeUsage)
      .where(eq(claudeUsage.shopId, ctx.shop.id));
    expect(usage).toMatchObject({ latencyMs: 412, requestId: "req_011CContent" });
  });

  it("keeps no byte of a large image, a document or a mixed array anywhere in the row", async () => {
    const content: Anthropic.ContentBlockParam[] = [
      { type: "text", text: "Front and back of the card." },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: IMAGE_DATA } },
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: IMAGE_DATA },
      },
      { type: "image", source: { type: "base64", media_type: "image/png", data: IMAGE_DATA } },
    ];
    await runAssist(ctx.db, {
      shopId: ctx.shop.id,
      feature: "cert_scan",
      call: cardCall(content),
      provider: answering("12345"),
      env: keyed,
      now,
    });
    const [row] = await contentRows(ctx.shop.id);
    expect(row?.contentText).toBe(
      [
        "Front and back of the card.",
        "[image: image/jpeg, 812 KB, not kept]",
        "[document: application/pdf, 812 KB, not kept]",
        "[image: image/png, 812 KB, not kept]",
      ].join("\n\n"),
    );
    // Every column, not only the content: no run of the payload survives.
    expect(JSON.stringify(row)).not.toContain("QUJD");
    expect(JSON.stringify(row).length).toBeLessThan(2_000);
  });

  it("answers exactly as it would have when the row cannot be written", async () => {
    // Postgres refuses a NUL in text, so this insert fails for real.
    const call = { ...cardCall("12345"), system: "Read the card number.\u0000" };
    const warned: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
      warned.push(String(line));
    });
    let value: unknown;
    try {
      value = await runAssist(ctx.db, {
        shopId: ctx.shop.id,
        feature: "cert_scan",
        call,
        provider: answering("12345"),
        env: keyed,
        now,
      });
    } finally {
      warn.mockRestore();
    }
    expect(value).toEqual({ number: "12345" });
    expect(warned.join("\n")).toContain("claude_assist.content_not_kept");
    expect(await contentRows(ctx.shop.id)).toHaveLength(0);
    // The usage row still settled, and the database still answers afterwards:
    // the failed insert took only its own savepoint with it.
    const [usage] = await ctx.db
      .select()
      .from(claudeUsage)
      .where(eq(claudeUsage.shopId, ctx.shop.id));
    expect(usage).toMatchObject({ outcome: "ok", requestId: "req_011CContent" });
  });

  it("keeps the request when the call fails, with no answer", async () => {
    await runAssist(ctx.db, {
      shopId: ctx.shop.id,
      feature: "cert_scan",
      call: cardCall("12345"),
      provider: fakeClaude({
        reply: () => fakeClaudeMessage({ text: "", stopReason: "refusal" }),
      }),
      env: keyed,
      now,
    });
    const [row] = await contentRows(ctx.shop.id);
    expect(row).toMatchObject({ contentText: "12345", answerText: "" });
  });
});

describe("erasing a diver", () => {
  async function otherShop() {
    const [shop] = await ctx.db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef", timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("insert failed");
    return shop;
  }

  async function keepRow(shopId: string, text: string) {
    const [usage] = await ctx.db
      .insert(claudeUsage)
      .values({ shopId, feature: "inbox_draft", model: "claude-sonnet-5-5", outcome: "ok" })
      .returning({ id: claudeUsage.id });
    if (!usage) throw new Error("insert failed");
    await ctx.db
      .insert(claudeCallContent)
      .values({ usageId: usage.id, shopId, systemText: "Draft.", contentText: text });
  }

  async function personWith(role: "owner" | "diver") {
    const [row] = await ctx.db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(
        and(
          eq(people.shopId, ctx.shop.id),
          eq(personRoles.role, role),
          isNull(people.deletedAt),
          isNull(people.anonymizedAt),
        ),
      )
      .orderBy(people.id)
      .limit(1);
    if (!row) throw new Error(`expected a seeded ${role}`);
    return row.id;
  }

  it("deletes every content row for the shop, and none of another shop's", async () => {
    const other = await otherShop();
    await keepRow(ctx.shop.id, "Hi, it’s Ana. Can I move Saturday?");
    await keepRow(ctx.shop.id, "Somebody else’s gear note");
    await keepRow(other.id, "Another shop’s message");

    await anonymizeDiver(ctx.db, {
      shopId: ctx.shop.id,
      personId: await personWith("diver"),
      actorPersonId: await personWith("owner"),
    });

    expect(await contentRows(ctx.shop.id)).toHaveLength(0);
    expect((await contentRows(other.id)).map((row) => row.contentText)).toEqual([
      "Another shop’s message",
    ]);
    // The cost ledger stays: it holds no words.
    expect(
      await ctx.db.select().from(claudeUsage).where(eq(claudeUsage.shopId, ctx.shop.id)),
    ).toHaveLength(2);
  });

  it("keeps nothing from a call that finishes after an erasure at the shop", async () => {
    await anonymizeDiver(ctx.db, {
      shopId: ctx.shop.id,
      personId: await personWith("diver"),
      actorPersonId: await personWith("owner"),
    });
    const value = await runAssist(ctx.db, {
      shopId: ctx.shop.id,
      feature: "inbox_draft",
      call: cardCall("Hi, it’s Ana. Can I move Saturday?"),
      provider: answering("12345"),
      env: keyed,
      now: nowDate(),
    });
    expect(value).toEqual({ number: "12345" });
    expect(await contentRows(ctx.shop.id)).toHaveLength(0);
  });

  it("goes with its shop", async () => {
    const other = await otherShop();
    await keepRow(other.id, "Another shop’s message");
    await ctx.db.delete(shops).where(eq(shops.id, other.id));
    expect(await contentRows(other.id)).toHaveLength(0);
  });
});
