import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { PayoutSummary, PayoutSummaryLookup } from "@/lib/payments/payout-summary";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import {
  latestShopPayouts,
  listShopPayoutsArriving,
  PAYOUT_SUMMARY_RETRY_DELAYS_MS,
  type PayoutEvent,
  type PayoutOutcome,
  recordStripePayout,
  summarizeStripePayout,
} from "./payouts";
import { shops, stripePayouts } from "./schema";
import { disconnectShopStripeAccount, upsertShopStripeAccount } from "./stripe-accounts";

const ctx = fileScopedShopContext();

const ACCOUNT = "acct_payoutsShop1";
const SEP_27 = new Date("2026-09-27T15:00:00Z");
const OCT_1 = new Date("2026-10-01T12:00:00Z");
const OCT_3 = new Date("2026-10-03T00:00:00Z");

function lookupAnswering(answer: PayoutSummary) {
  const summarize = vi.fn(async () => answer);
  const lookup: PayoutSummaryLookup = { summarize };
  return { lookup, summarize };
}

const SUMMARIZED: PayoutSummary = {
  status: "summarized",
  coveredFrom: SEP_27,
  coveredTo: OCT_1,
  feeCents: 5_430,
};

function payoutEvent(
  overrides: Partial<PayoutEvent["payout"]> & { account?: string; at: string },
): PayoutEvent {
  return {
    stripeAccountId: overrides.account ?? ACCOUNT,
    occurredAt: new Date(overrides.at),
    payout: {
      id: overrides.id ?? "po_1",
      amountCents: overrides.amountCents ?? 184_200,
      currency: overrides.currency ?? "usd",
      status: overrides.status ?? "paid",
      arrivalDate: overrides.arrivalDate ?? OCT_3,
      automatic: overrides.automatic ?? true,
      failureCode: overrides.failureCode ?? null,
    },
  };
}

/**
 * What the webhook does: record the row, answer, then ask Stripe what a paid
 * payout carried (route.ts runs the second half from `after()`). The outcome's
 * payout is re-read so it shows the summary.
 */
async function recordAndSummarize(
  db: AppDb,
  event: PayoutEvent,
  lookup: PayoutSummaryLookup,
): Promise<PayoutOutcome> {
  const outcome = await recordStripePayout(db, event);
  if (outcome.status !== "recorded" || !outcome.needsSummary) return outcome;
  await summarizeStripePayout(
    db,
    lookup,
    {
      stripeAccountId: event.stripeAccountId,
      payoutId: event.payout.id,
      automatic: event.payout.automatic,
    },
    async () => {},
  );
  const [payout] = await db
    .select()
    .from(stripePayouts)
    .where(eq(stripePayouts.stripePayoutId, event.payout.id));
  return { ...outcome, payout: payout ?? outcome.payout };
}

async function connected(db: AppDb) {
  await upsertShopStripeAccount(db, ctx.shop.id, ACCOUNT);
}

describe("recordStripePayout", () => {
  it("records a paid payout against the shop holding the event's account, with what it carried", async () => {
    const { db } = ctx;
    await connected(db);
    const { lookup, summarize } = lookupAnswering(SUMMARIZED);
    const outcome = await recordAndSummarize(
      db,
      payoutEvent({ at: "2026-10-03T01:00:00Z" }),
      lookup,
    );
    expect(outcome).toMatchObject({
      status: "recorded",
      payout: {
        shopId: ctx.shop.id,
        stripePayoutId: "po_1",
        amountCents: 184_200,
        status: "paid",
        coveredFrom: SEP_27,
        coveredTo: OCT_1,
        feeCents: 5_430,
      },
    });
    expect(summarize).toHaveBeenCalledWith(ACCOUNT, "po_1", { automatic: true });
  });

  it("is not the business of a shop that does not hold the account", async () => {
    const { db } = ctx;
    const { lookup, summarize } = lookupAnswering(SUMMARIZED);
    const outcome = await recordAndSummarize(
      db,
      payoutEvent({ account: "acct_nobodysAccount", at: "2026-10-03T01:00:00Z" }),
      lookup,
    );
    expect(outcome).toEqual({ status: "not_found" });
    expect(summarize).not.toHaveBeenCalled();
    expect(await db.select().from(stripePayouts)).toHaveLength(0);
  });

  it("is no longer the business of a shop that disconnected the account", async () => {
    const { db } = ctx;
    await connected(db);
    await disconnectShopStripeAccount(db, ACCOUNT);
    const { lookup, summarize } = lookupAnswering(SUMMARIZED);
    const outcome = await recordAndSummarize(
      db,
      payoutEvent({ at: "2026-10-03T01:00:00Z" }),
      lookup,
    );
    expect(outcome).toEqual({ status: "not_found" });
    expect(summarize).not.toHaveBeenCalled();
    expect(await db.select().from(stripePayouts)).toHaveLength(0);
  });

  it("a replay changes nothing and never asks Stripe twice", async () => {
    const { db } = ctx;
    await connected(db);
    const { lookup, summarize } = lookupAnswering(SUMMARIZED);
    const event = payoutEvent({ at: "2026-10-03T01:00:00Z" });
    await recordAndSummarize(db, event, lookup);
    await recordAndSummarize(db, event, lookup);
    expect(summarize).toHaveBeenCalledTimes(1);
    const rows = await db.select().from(stripePayouts);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.feeCents).toBe(5_430);
  });

  it("records the payout before Stripe is asked, and says it still needs a summary", async () => {
    const { db } = ctx;
    await connected(db);
    const outcome = await recordStripePayout(db, payoutEvent({ at: "2026-10-03T01:00:00Z" }));
    expect(outcome).toMatchObject({
      status: "recorded",
      needsSummary: true,
      payout: { feeCents: null, coveredFrom: null },
    });
    const failed = await recordStripePayout(
      db,
      payoutEvent({ id: "po_f", status: "failed", at: "2026-10-03T01:00:00Z" }),
    );
    expect(failed).toMatchObject({ status: "recorded", needsSummary: false });
  });

  it("retries a Stripe that cannot be reached, then keeps the payout without a summary", async () => {
    const { db } = ctx;
    await connected(db);
    await recordStripePayout(db, payoutEvent({ at: "2026-10-03T01:00:00Z" }));
    const { lookup, summarize } = lookupAnswering({ status: "failed" });
    const sleeps: number[] = [];
    expect(
      await summarizeStripePayout(
        db,
        lookup,
        { stripeAccountId: ACCOUNT, payoutId: "po_1", automatic: true },
        async (ms) => {
          sleeps.push(ms);
        },
      ),
    ).toBe("failed");
    expect(sleeps).toEqual([...PAYOUT_SUMMARY_RETRY_DELAYS_MS]);
    expect(summarize).toHaveBeenCalledTimes(PAYOUT_SUMMARY_RETRY_DELAYS_MS.length + 1);
    const [row] = await db.select().from(stripePayouts);
    expect(row).toMatchObject({ status: "paid", feeCents: null, coveredFrom: null });
  });

  it("stores a summary once: a second run, or one after a failure, writes nothing", async () => {
    const { db } = ctx;
    await connected(db);
    await recordStripePayout(db, payoutEvent({ at: "2026-10-03T01:00:00Z" }));
    const ref = { stripeAccountId: ACCOUNT, payoutId: "po_1", automatic: true };
    const none = async () => {};
    await summarizeStripePayout(db, lookupAnswering(SUMMARIZED).lookup, ref, none);
    await summarizeStripePayout(
      db,
      lookupAnswering({ ...SUMMARIZED, feeCents: 1 }).lookup,
      ref,
      none,
    );
    const [row] = await db.select().from(stripePayouts);
    expect(row?.feeCents).toBe(5_430);

    await recordStripePayout(db, payoutEvent({ id: "po_2", at: "2026-10-03T01:00:00Z" }));
    await recordStripePayout(
      db,
      payoutEvent({ id: "po_2", status: "failed", at: "2026-10-04T01:00:00Z" }),
    );
    await summarizeStripePayout(
      db,
      lookupAnswering(SUMMARIZED).lookup,
      { ...ref, payoutId: "po_2" },
      none,
    );
    const [failed] = await db
      .select()
      .from(stripePayouts)
      .where(eq(stripePayouts.stripePayoutId, "po_2"));
    expect(failed).toMatchObject({ status: "failed", feeCents: null });
  });

  it("records a manual payout with its own fee and no span", async () => {
    const { db } = ctx;
    await connected(db);
    const { lookup, summarize } = lookupAnswering({
      status: "summarized",
      coveredFrom: null,
      coveredTo: null,
      feeCents: 150,
    });
    const outcome = await recordAndSummarize(
      db,
      payoutEvent({ automatic: false, at: "2026-10-03T01:00:00Z" }),
      lookup,
    );
    expect(outcome).toMatchObject({
      status: "recorded",
      payout: { feeCents: 150, coveredFrom: null, coveredTo: null },
    });
    expect(summarize).toHaveBeenCalledWith(ACCOUNT, "po_1", { automatic: false });
    // A zero fee is an answer: a replay does not ask again.
    await recordAndSummarize(
      db,
      payoutEvent({ automatic: false, at: "2026-10-03T02:00:00Z" }),
      lookup,
    );
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it("records a manual payout Stripe will not describe with no fee", async () => {
    const { db } = ctx;
    await connected(db);
    const { lookup } = lookupAnswering({ status: "unavailable" });
    const outcome = await recordAndSummarize(
      db,
      payoutEvent({ automatic: false, at: "2026-10-03T01:00:00Z" }),
      lookup,
    );
    expect(outcome).toMatchObject({
      status: "recorded",
      payout: { feeCents: null, coveredFrom: null },
    });
  });

  it("a failure after paid wins, and a late paid never undoes it", async () => {
    const { db } = ctx;
    await connected(db);
    const { lookup } = lookupAnswering(SUMMARIZED);
    await recordAndSummarize(db, payoutEvent({ at: "2026-10-03T01:00:00Z" }), lookup);
    const failed = await recordAndSummarize(
      db,
      payoutEvent({ status: "failed", failureCode: "account_closed", at: "2026-10-04T09:00:00Z" }),
      lookup,
    );
    expect(failed).toMatchObject({
      status: "recorded",
      payout: { status: "failed", failureCode: "account_closed", feeCents: 5_430 },
    });
    // The same paid event, redelivered after the failure — and one stamped later.
    expect(
      await recordAndSummarize(db, payoutEvent({ at: "2026-10-03T01:00:00Z" }), lookup),
    ).toEqual({ status: "stale" });
    expect(
      await recordAndSummarize(db, payoutEvent({ at: "2026-10-05T01:00:00Z" }), lookup),
    ).toEqual({ status: "stale" });
    const [row] = await db.select().from(stripePayouts);
    expect(row?.status).toBe("failed");
  });

  it("a cancelled payout reads as cancelled, and a late paid never undoes it", async () => {
    const { db } = ctx;
    await connected(db);
    const { lookup, summarize } = lookupAnswering(SUMMARIZED);
    const canceled = await recordAndSummarize(
      db,
      payoutEvent({ status: "canceled", at: "2026-10-03T01:00:00Z" }),
      lookup,
    );
    expect(canceled).toMatchObject({
      status: "recorded",
      payout: { status: "canceled", failureCode: null, feeCents: null },
    });
    expect(summarize).not.toHaveBeenCalled();
    expect(
      await recordAndSummarize(db, payoutEvent({ at: "2026-10-05T01:00:00Z" }), lookup),
    ).toEqual({ status: "stale" });
    const [row] = await db.select().from(stripePayouts);
    expect(row?.status).toBe("canceled");
    // Neither the Orders index's paid line nor its failure warning reads it.
    expect(await latestShopPayouts(db, ctx.shop.id)).toEqual({ paid: null, failed: null });
  });

  it("never moves a payout to another account", async () => {
    const { db } = ctx;
    await connected(db);
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef-payouts", timezone: "America/New_York" })
      .returning();
    if (!other) throw new Error("other shop insert failed");
    await upsertShopStripeAccount(db, other.id, "acct_otherReefShop");
    const { lookup } = lookupAnswering(SUMMARIZED);
    await recordAndSummarize(db, payoutEvent({ at: "2026-10-03T01:00:00Z" }), lookup);
    const hijack = await recordAndSummarize(
      db,
      payoutEvent({
        account: "acct_otherReefShop",
        status: "failed",
        amountCents: 1,
        at: "2026-10-09T01:00:00Z",
      }),
      lookup,
    );
    expect(hijack).toEqual({ status: "stale" });
    const [row] = await db
      .select()
      .from(stripePayouts)
      .where(eq(stripePayouts.stripePayoutId, "po_1"));
    expect(row).toMatchObject({ shopId: ctx.shop.id, amountCents: 184_200, status: "paid" });
  });
});

describe("reading payouts back", () => {
  it("lists the month's arrivals for this shop only, and the Orders index's latest", async () => {
    const { db } = ctx;
    await connected(db);
    const { lookup } = lookupAnswering(SUMMARIZED);
    await recordAndSummarize(db, payoutEvent({ at: "2026-10-03T01:00:00Z" }), lookup);
    await recordAndSummarize(
      db,
      payoutEvent({
        id: "po_2",
        status: "failed",
        failureCode: "no_account",
        arrivalDate: new Date("2026-10-06T00:00:00Z"),
        at: "2026-10-06T09:00:00Z",
      }),
      lookup,
    );
    await recordAndSummarize(
      db,
      payoutEvent({
        id: "po_sept",
        arrivalDate: new Date("2026-09-20T00:00:00Z"),
        at: "2026-09-20T01:00:00Z",
      }),
      lookup,
    );
    const october = await listShopPayoutsArriving(db, ctx.shop.id, {
      from: new Date("2026-10-01T00:00:00Z"),
      to: new Date("2026-11-01T00:00:00Z"),
    });
    expect(october.map((row) => row.status)).toEqual(["paid", "failed"]);
    const otherShopId = "00000000-0000-4000-8000-000000000000";
    expect(
      await listShopPayoutsArriving(db, otherShopId, {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2027-01-01T00:00:00Z"),
      }),
    ).toEqual([]);
    const latest = await latestShopPayouts(db, ctx.shop.id);
    expect(latest.paid?.arrivalDate).toEqual(OCT_3);
    expect(latest.failed?.failureCode).toBe("no_account");
  });

  it("leaves a deleted row out", async () => {
    const { db } = ctx;
    await connected(db);
    const { lookup } = lookupAnswering(SUMMARIZED);
    await recordAndSummarize(db, payoutEvent({ at: "2026-10-03T01:00:00Z" }), lookup);
    await db.update(stripePayouts).set({ deletedAt: new Date("2026-10-04T00:00:00Z") });
    expect(await latestShopPayouts(db, ctx.shop.id)).toEqual({ paid: null, failed: null });
  });
});
