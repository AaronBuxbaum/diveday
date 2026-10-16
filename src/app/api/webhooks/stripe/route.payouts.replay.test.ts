import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/**
 * Hostile-sequence replay of `payout.*` through the REAL webhook route and the
 * REAL handlers on PGlite (ADR 20261012-payouts-reach-diveday), split from
 * `route.replay.test.ts` to keep that file inside its length limit. The
 * summary a paid payout earns runs after the response, so each test settles
 * what the route handed to `after()` the way Next does.
 */

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
// A paid payout's summary runs after the response; `settleAfter` is Next finishing it.
const deferredWork = vi.hoisted(() => ({ pending: [] as Promise<unknown>[] }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: (() => unknown) | Promise<unknown>) => {
    deferredWork.pending.push(
      Promise.resolve().then(() => (typeof task === "function" ? task() : task)),
    );
  },
}));
async function settleAfter() {
  const work = deferredWork.pending.splice(0);
  await Promise.all(work);
}
// The routes report only where a DSN is configured; the suite runs without one.
vi.mock("@/lib/sentry-dsn", () => ({ SENTRY_DSN: "https://key@sentry.invalid/1" }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const { getDb } = await import("@/db/client");
const { stripePayouts } = await import("@/db/schema");
const { latestShopPayouts } = await import("@/db/payouts");
const { setShopStripeAccountStatus, upsertShopStripeAccount } = await import(
  "@/db/stripe-accounts"
);
const { POST } = await import("./route");

const secret = "whsec_replay";
const ACCOUNT = "acct_replay";

/** Deliver one event through the real route, signed like Stripe signs it. */
async function deliver(event: Record<string, unknown>): Promise<Response> {
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
  vi.stubEnv("STRIPE_TEST_WEBHOOK_SECRET", "");
  const payload = JSON.stringify({ livemode: true, account: ACCOUNT, ...event });
  const timestamp = Math.floor(nowMs() / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return POST(
    new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
      body: payload,
    }),
  );
}

/** A connected shop wired as the route's own database. */
async function connectedShop() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db as never);
  await upsertShopStripeAccount(db, shop.id, ACCOUNT);
  await setShopStripeAccountStatus(db, ACCOUNT, {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  return { db, shop };
}

describe("payout.* hostile sequences (real handlers, real db)", () => {
  function payoutEvent(
    id: string,
    type: "payout.paid" | "payout.failed",
    options: { ageSeconds?: number; amount?: number } = {},
  ) {
    const now = Math.floor(nowMs() / 1000);
    return {
      id,
      type,
      created: now - (options.ageSeconds ?? 0),
      data: {
        object: {
          id: "po_replay",
          amount: options.amount ?? 184_200,
          currency: "usd",
          arrival_date: now - 86_400,
          status: type === "payout.paid" ? "paid" : "failed",
          automatic: true,
          failure_code: type === "payout.failed" ? "account_closed" : null,
        },
      },
    };
  }

  /** Stripe's balance transactions for the payout, served to the platform key only. */
  function stripeServing(transactions: Array<{ created: number; fee: number; type: string }>) {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        has_more: false,
        data: transactions.map((transaction, index) => ({ id: `txn_${index}`, ...transaction })),
      }),
    );
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_replay");
    vi.stubGlobal("fetch", fetchImpl);
    return fetchImpl;
  }

  it("records the payout with its span and fees once, and a replay asks Stripe nothing more", async () => {
    const { db, shop } = await connectedShop();
    const day = Math.floor(nowMs() / 1000) - 5 * 86_400;
    const fetchImpl = stripeServing([
      { type: "payout", created: day + 4 * 86_400, fee: 0 },
      { type: "charge", created: day + 2 * 86_400, fee: 640 },
      { type: "charge", created: day, fee: 520 },
    ]);
    try {
      expect((await deliver(payoutEvent("evt_p1", "payout.paid"))).status).toBe(200);
      await settleAfter();
      expect((await deliver(payoutEvent("evt_p1", "payout.paid"))).status).toBe(200);
      await settleAfter();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const latest = await latestShopPayouts(db, shop.id);
      expect(latest.paid).toMatchObject({
        amountCents: 184_200,
        feeCents: 1_160,
        coveredFrom: new Date(day * 1000),
        coveredTo: new Date((day + 2 * 86_400) * 1000),
      });
      expect(latest.failed).toBeNull();

      // Stripe fails it after paying it; the earlier paid event, redelivered, never undoes that.
      await deliver(payoutEvent("evt_p2", "payout.failed"));
      await deliver(payoutEvent("evt_p3", "payout.paid", { ageSeconds: 600 }));
      await settleAfter();
      const [row] = await db
        .select()
        .from(stripePayouts)
        .where(eq(stripePayouts.stripePayoutId, "po_replay"));
      expect(row).toMatchObject({
        status: "failed",
        failureCode: "account_closed",
        shopId: shop.id,
      });
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("a payout to an account no shop holds is not recorded", async () => {
    const { db } = await connectedShop();
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    try {
      const event = payoutEvent("evt_px", "payout.paid");
      expect((await deliver({ ...event, account: "acct_strangers" })).status).toBe(200);
      expect(await db.select().from(stripePayouts)).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("answers before Stripe is asked, and a Stripe that stays down leaves the payout without a fee", async () => {
    const { db, shop } = await connectedShop();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_replay");
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetchImpl);
    try {
      expect((await deliver(payoutEvent("evt_pd", "payout.paid"))).status).toBe(200);
      // Recorded already, with Stripe not yet asked.
      expect((await latestShopPayouts(db, shop.id)).paid).toMatchObject({ feeCents: null });
      const settled = settleAfter();
      await vi.runAllTimersAsync();
      await settled;
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      expect((await latestShopPayouts(db, shop.id)).paid).toMatchObject({ feeCents: null });
      // Stripe resends the event once it is back up: now it is summarized.
      vi.useRealTimers();
      stripeServing([{ type: "charge", created: Math.floor(nowMs() / 1000), fee: 99 }]);
      expect((await deliver(payoutEvent("evt_pd2", "payout.paid"))).status).toBe(200);
      await settleAfter();
      expect((await latestShopPayouts(db, shop.id)).paid?.feeCents).toBe(99);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
