import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { StructuredCall } from "@/lib/claude/structured";
import { fileScopedShopContext } from "@/test/db";
import { fakeClaude, fakeClaudeMessage } from "@/test/fakes";
import {
  assistDarkReasonFor,
  claudeSpendUsdBetween,
  runAssist,
  shopClaudeSpendMicroUsd,
} from "./assists";
import { claudeUsage, shops } from "./schema";
import { setShopFeature } from "./shops";

const ctx = fileScopedShopContext();

// The seeded shop is the canonical demo, and demos are dark (anyone can mint
// one); these tests are about a real shop, so each starts as one.
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

  it("is dark for a demo shop, whatever its switch and spend", async () => {
    await ctx.db.update(shops).set({ isDemo: true }).where(eq(shops.id, ctx.shop.id));
    expect(await assistDarkReasonFor(ctx.db, ctx.shop.id, { env: keyed, now })).toBe("demo_shop");
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
