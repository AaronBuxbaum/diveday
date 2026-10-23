import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { StructuredCall } from "@/lib/claude/structured";
import { fileScopedShopContext } from "@/test/db";
import { fakeClaude, fakeClaudeMessage } from "@/test/fakes";
import {
  assistDarkReasonFor,
  assistsAvailable,
  claudeSpendUsdBetween,
  demoClaudeSpendMicroUsd,
  IN_FLIGHT_WINDOW_MS,
  MAX_CALLS_IN_FLIGHT,
  reservedMicroUsd,
  runAssist,
  shopClaudeSpendMicroUsd,
} from "./assists";
import { claudeDemoSpend, claudeUsage, shops } from "./schema";
import { setShopFeature } from "./shops";

const ctx = fileScopedShopContext();

// The seeded shop is the canonical demo, and demos run under their own small
// caps (anyone can mint one); these tests are about a real shop, so each starts
// as one, and the demo allowance has its own block below.
beforeEach(async () => {
  await ctx.db.update(shops).set({ isDemo: false }).where(eq(shops.id, ctx.shop.id));
});

const Reply = z.object({ draft: z.string() });
const call: StructuredCall<typeof Reply> = {
  model: "draft",
  system: "Draft a reply.",
  content: "Is there space Saturday?",
  schema: Reply,
};

const keyed = { ANTHROPIC_API_KEY: "test-anthropic-key" };
const now = new Date("2026-10-18T12:00:00.000Z");

function replying(draft: string) {
  return fakeClaude({
    reply: () =>
      fakeClaudeMessage({
        text: JSON.stringify({ draft }),
        usage: { input_tokens: 1_000, output_tokens: 100 },
      }),
  });
}

async function otherShop() {
  const [shop] = await ctx.db
    .insert(shops)
    .values({ name: "Other Reef", slug: "other-reef", timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("insert failed");
  return shop;
}

/** A demo minted from the public door: not the canonical one. */
async function mintedDemo() {
  const shop = await otherShop();
  await ctx.db.update(shops).set({ isDemo: true }).where(eq(shops.id, shop.id));
  return shop;
}

async function spend(shopId: string, costMicroUsd: number, createdAt: Date) {
  await ctx.db.insert(claudeUsage).values({
    shopId,
    feature: "test",
    model: "claude-sonnet-5-5",
    outcome: "ok",
    costMicroUsd,
    createdAt,
  });
}

describe("runAssist", () => {
  it("returns the validated value and records the call, codes and numbers only", async () => {
    const provider = replying("Yes, two seats left.");
    const value = await runAssist(ctx.db, {
      shopId: ctx.shop.id,
      feature: "inbox_draft",
      call,
      provider,
      env: keyed,
      now,
    });
    expect(value).toEqual({ draft: "Yes, two seats left." });
    const rows = await ctx.db.select().from(claudeUsage).where(eq(claudeUsage.shopId, ctx.shop.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      feature: "inbox_draft",
      model: "claude-sonnet-5-5",
      outcome: "ok",
      errorCode: null,
      inputTokens: 1_000,
      outputTokens: 100,
      costMicroUsd: 2_000 + 1_000,
    });
  });

  it("records a failed call too, and answers null", async () => {
    const provider = fakeClaude({
      reply: () => fakeClaudeMessage({ text: "", stopReason: "refusal" }),
    });
    const value = await runAssist(ctx.db, {
      shopId: ctx.shop.id,
      feature: "inbox_draft",
      call,
      provider,
      env: keyed,
      now,
    });
    expect(value).toBeNull();
    const [row] = await ctx.db
      .select()
      .from(claudeUsage)
      .where(eq(claudeUsage.shopId, ctx.shop.id));
    expect(row?.outcome).toBe("refused");
  });

  it("is dark, without calling Claude or writing a row, when the shop switched it off", async () => {
    await setShopFeature(ctx.db, ctx.shop.id, "claudeSuggestions", false);
    const provider = replying("unused");
    const value = await runAssist(ctx.db, {
      shopId: ctx.shop.id,
      feature: "inbox_draft",
      call,
      provider,
      env: keyed,
      now,
    });
    expect(value).toBeNull();
    expect(provider.requests).toHaveLength(0);
    expect(await ctx.db.select().from(claudeUsage)).toHaveLength(0);
  });

  it("is dark once the shop's month reaches its cap", async () => {
    await spend(ctx.shop.id, 15_000_000, new Date("2026-10-02T00:00:00.000Z"));
    const provider = replying("unused");
    expect(
      await runAssist(ctx.db, {
        shopId: ctx.shop.id,
        feature: "inbox_draft",
        call,
        provider,
        env: keyed,
        now,
      }),
    ).toBeNull();
    expect(provider.requests).toHaveLength(0);
  });

  it("runs at most two calls at once for one shop, however many are fired together", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    const provider = {
      requests: [] as unknown[],
      async createMessage() {
        started += 1;
        await gate;
        return fakeClaudeMessage({ text: JSON.stringify({ draft: "ok" }) });
      },
    };
    const runs = Array.from({ length: 10 }, () =>
      runAssist(ctx.db, {
        shopId: ctx.shop.id,
        feature: "inbox_draft",
        call,
        provider,
        env: keyed,
        now,
      }),
    );
    // Let every reservation settle before the provider answers.
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    const values = await Promise.all(runs);
    expect(started).toBe(MAX_CALLS_IN_FLIGHT);
    expect(values.filter((value) => value !== null)).toHaveLength(MAX_CALLS_IN_FLIGHT);
    const rows = await ctx.db.select().from(claudeUsage).where(eq(claudeUsage.shopId, ctx.shop.id));
    expect(rows.map((row) => row.outcome)).toEqual(["ok", "ok"]);
  });

  it("refuses a call whose reservation would cross the cap, before sending it", async () => {
    const reserve = reservedMicroUsd(call);
    await spend(ctx.shop.id, 15_000_000 - reserve + 1, new Date("2026-10-02T00:00:00.000Z"));
    const provider = replying("unused");
    expect(
      await runAssist(ctx.db, {
        shopId: ctx.shop.id,
        feature: "inbox_draft",
        call,
        provider,
        env: keyed,
        now,
      }),
    ).toBeNull();
    expect(provider.requests).toHaveLength(0);
  });

  it("refuses a demo's call whose reservation would cross the demo allowance", async () => {
    const demo = await mintedDemo();
    const reserve = reservedMicroUsd(call);
    // The allowance has room for the dark check, not for this call's reservation.
    await ctx.db
      .insert(claudeDemoSpend)
      .values({ month: "2026-10-01", spentMicroUsd: 10_000_000 - reserve + 1 });
    const provider = replying("unused");
    expect(
      await runAssist(ctx.db, {
        shopId: demo.id,
        feature: "inbox_draft",
        call,
        provider,
        env: keyed,
        now,
      }),
    ).toBeNull();
    expect(provider.requests).toHaveLength(0);
  });

  it("keeps a deleted demo's spend in the allowance", async () => {
    const demo = await mintedDemo();
    const provider = replying("Yes.");
    await runAssist(ctx.db, {
      shopId: demo.id,
      feature: "inbox_draft",
      call,
      provider,
      env: keyed,
      now,
    });
    const [usage] = await ctx.db
      .select({ cost: claudeUsage.costMicroUsd })
      .from(claudeUsage)
      .where(eq(claudeUsage.shopId, demo.id));
    expect(usage?.cost).toBeGreaterThan(0);
    // The reaper and the mint cap delete demos; their usage rows cascade.
    await ctx.db.delete(shops).where(eq(shops.id, demo.id));
    expect(await demoClaudeSpendMicroUsd(ctx.db, now)).toBe(usage?.cost);
  });

  it("charges at least the reservation for a call that failed after it may have been billed", async () => {
    const provider = fakeClaude({
      reply: () => {
        throw new Anthropic.APIConnectionTimeoutError();
      },
    });
    expect(
      await runAssist(ctx.db, {
        shopId: ctx.shop.id,
        feature: "inbox_draft",
        call,
        provider,
        env: keyed,
        now,
      }),
    ).toBeNull();
    const [row] = await ctx.db
      .select()
      .from(claudeUsage)
      .where(eq(claudeUsage.shopId, ctx.shop.id));
    expect(row).toMatchObject({ outcome: "error", errorCode: "timeout" });
    expect(row?.costMicroUsd).toBe(reservedMicroUsd(call));
  });

  it("charges nothing extra for a call the API refused outright", async () => {
    const provider = fakeClaude({
      reply: () => {
        throw new Anthropic.BadRequestError(400, undefined, "bad", new Headers());
      },
    });
    await runAssist(ctx.db, {
      shopId: ctx.shop.id,
      feature: "inbox_draft",
      call,
      provider,
      env: keyed,
      now,
    });
    const [row] = await ctx.db
      .select()
      .from(claudeUsage)
      .where(eq(claudeUsage.shopId, ctx.shop.id));
    expect(row).toMatchObject({ outcome: "error", errorCode: "http_400", costMicroUsd: 0 });
  });

  it("refuses a feature key that is not a code", async () => {
    const provider = replying("unused");
    expect(
      await runAssist(ctx.db, {
        shopId: ctx.shop.id,
        feature: "Inbox draft for Ana",
        call,
        provider,
        env: keyed,
        now,
      }),
    ).toBeNull();
    expect(provider.requests).toHaveLength(0);
  });
});

describe("assistDarkReasonFor", () => {
  it("is dark with no key in the environment and no provider injected", async () => {
    expect(await assistDarkReasonFor(ctx.db, ctx.shop.id, { env: {}, now })).toBe("no_key");
  });

  it("is dark when external HTTP is off, unless a test injected its own provider", async () => {
    const env = { ...keyed, DIVEDAY_DISABLE_EXTERNAL_HTTP: "1" };
    expect(await assistDarkReasonFor(ctx.db, ctx.shop.id, { env, now })).toBe(
      "external_http_disabled",
    );
    expect(
      await assistDarkReasonFor(ctx.db, ctx.shop.id, { env, now, provider: replying("x") }),
    ).toBeNull();
  });

  it("is lit by default: the switch starts on", async () => {
    expect(await assistDarkReasonFor(ctx.db, ctx.shop.id, { env: keyed, now })).toBeNull();
  });

  it("is dark for a shop that does not exist", async () => {
    expect(
      await assistDarkReasonFor(ctx.db, "00000000-0000-0000-0000-000000000000", {
        env: keyed,
        now,
      }),
    ).toBe("shop_off");
  });

  it("is lit for a minted demo under its own cap and the demo allowance", async () => {
    const demo = await mintedDemo();
    expect(await assistDarkReasonFor(ctx.db, demo.id, { env: keyed, now })).toBeNull();
  });

  it("holds a minted demo to the demo cap, not a real shop's", async () => {
    const demo = await mintedDemo();
    await spend(demo.id, 1_000_000, now);
    expect(await assistDarkReasonFor(ctx.db, demo.id, { env: keyed, now })).toBe("over_cap");
  });

  it("darkens every minted demo once the demo ledger reaches the allowance", async () => {
    const demo = await mintedDemo();
    await ctx.db.insert(claudeDemoSpend).values({ month: "2026-10-01", spentMicroUsd: 10_000_000 });
    expect(await assistDarkReasonFor(ctx.db, demo.id, { env: keyed, now })).toBe("demo_over_cap");
  });

  it("keeps the canonical demo on a real shop's cap, outside the allowance", async () => {
    await ctx.db.update(shops).set({ isDemo: true }).where(eq(shops.id, ctx.shop.id));
    await ctx.db.insert(claudeDemoSpend).values({ month: "2026-10-01", spentMicroUsd: 10_000_000 });
    await spend(ctx.shop.id, 5_000_000, now);
    expect(await assistDarkReasonFor(ctx.db, ctx.shop.id, { env: keyed, now })).toBeNull();
  });

  it("takes the cap from the environment", async () => {
    await spend(ctx.shop.id, 1_000_000, now);
    expect(
      await assistDarkReasonFor(ctx.db, ctx.shop.id, {
        env: { ...keyed, DIVEDAY_CLAUDE_SHOP_MONTHLY_CAP_USD: "1" },
        now,
      }),
    ).toBe("over_cap");
  });
});

describe("IN_FLIGHT_WINDOW_MS", () => {
  it("outlasts the longest call: four turns of a 90 s timeout, each retried once", () => {
    expect(IN_FLIGHT_WINDOW_MS).toBeGreaterThanOrEqual(4 * 2 * 90_000);
  });
});

describe("assistsAvailable", () => {
  it("reads as dark when the read throws, so an assist is never why a page fails", async () => {
    // Not a uuid: the shop read itself throws.
    await expect(assistsAvailable(ctx.db, "not-a-shop-id", { env: keyed, now })).resolves.toBe(
      false,
    );
  });

  it("is lit for a lit shop", async () => {
    expect(await assistsAvailable(ctx.db, ctx.shop.id, { env: keyed, now })).toBe(true);
  });
});

describe("shopClaudeSpendMicroUsd", () => {
  it("sums this UTC month for one shop only", async () => {
    const other = await otherShop();
    await spend(ctx.shop.id, 100, new Date("2026-09-30T23:59:59.999Z")); // last month
    await spend(ctx.shop.id, 200, new Date("2026-10-01T00:00:00.000Z")); // first instant
    await spend(ctx.shop.id, 300, now);
    await spend(other.id, 9_999, now);
    expect(await shopClaudeSpendMicroUsd(ctx.db, ctx.shop.id, now)).toBe(500);
    expect(await shopClaudeSpendMicroUsd(ctx.db, other.id, now)).toBe(9_999);
  });

  it("is zero for a shop with no calls", async () => {
    expect(await shopClaudeSpendMicroUsd(ctx.db, ctx.shop.id, now)).toBe(0);
  });
});

describe("claudeSpendUsdBetween", () => {
  it("sums every shop over the half-open window, in dollars", async () => {
    const other = await otherShop();
    const start = new Date("2026-10-01T00:00:00.000Z");
    const end = new Date("2026-11-01T00:00:00.000Z");
    await spend(ctx.shop.id, 1_500_000, now);
    await spend(other.id, 500_000, now);
    await spend(other.id, 7_000_000, end); // next month
    expect(await claudeSpendUsdBetween(ctx.db, start, end)).toBe(2);
  });
});
