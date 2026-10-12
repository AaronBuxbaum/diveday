import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { PayoutSummary, PayoutSummaryLookup } from "@/lib/payments/payout-summary";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import {
  latestShopPayouts,
  listShopPayoutsArriving,
  type PayoutEvent,
  recordStripePayout,
} from "./payouts";
import { shops, stripePayouts } from "./schema";
import { upsertShopStripeAccount } from "./stripe-accounts";

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

async function connected(db: AppDb) {
  await upsertShopStripeAccount(db, ctx.shop.id, ACCOUNT);
}

describe("recordStripePayout", () => {
  it("records a paid payout against the shop holding the event's account, with what it carried", async () => {
    const { db } = ctx;
    await connected(db);
    const { lookup, summarize } = lookupAnswering(SUMMARIZED);
    const outcome = await recordStripePayout(
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
    expect(summarize).toHaveBeenCalledWith(ACCOUNT, "po_1");
  });

  it("is not the business of a shop that does not hold the account", async () => {
    const { db } = ctx;
    const { lookup, summarize } = lookupAnswering(SUMMARIZED);
    const outcome = await recordStripePayout(
      db,
      payoutEvent({ account: "acct_nobodysAccount", at: "2026-10-03T01:00:00Z" }),
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
    await recordStripePayout(db, event, lookup);
    await recordStripePayout(db, event, lookup);
    expect(summarize).toHaveBeenCalledTimes(1);
    const rows = await db.select().from(stripePayouts);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.feeCents).toBe(5_430);
  });

  it("defers rather than record a payout Stripe could not be asked about", async () => {
    const { db } = ctx;
    await connected(db);
    const { lookup } = lookupAnswering({ status: "failed" });
    expect(
      await recordStripePayout(db, payoutEvent({ at: "2026-10-03T01:00:00Z" }), lookup),
    ).toEqual({ status: "deferred" });
    expect(await db.select().from(stripePayouts)).toHaveLength(0);
  });

  it("records a manual payout without asking Stripe to itemize it", async () => {
    const { db } = ctx;
    await connected(db);
    const { lookup, summarize } = lookupAnswering(SUMMARIZED);
    const outcome = await recordStripePayout(
      db,
      payoutEvent({ automatic: false, at: "2026-10-03T01:00:00Z" }),
      lookup,
    );
    expect(outcome).toMatchObject({
      status: "recorded",
      payout: { feeCents: null, coveredFrom: null },
    });
    expect(summarize).not.toHaveBeenCalled();
  });

  it("a failure after paid wins, and a late paid never undoes it", async () => {
    const { db } = ctx;
    await connected(db);
    const { lookup } = lookupAnswering(SUMMARIZED);
    await recordStripePayout(db, payoutEvent({ at: "2026-10-03T01:00:00Z" }), lookup);
    const failed = await recordStripePayout(
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
      await recordStripePayout(db, payoutEvent({ at: "2026-10-03T01:00:00Z" }), lookup),
    ).toEqual({ status: "stale" });
    expect(
      await recordStripePayout(db, payoutEvent({ at: "2026-10-05T01:00:00Z" }), lookup),
    ).toEqual({ status: "stale" });
    const [row] = await db.select().from(stripePayouts);
    expect(row?.status).toBe("failed");
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
    await recordStripePayout(db, payoutEvent({ at: "2026-10-03T01:00:00Z" }), lookup);
    const hijack = await recordStripePayout(
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
    await recordStripePayout(db, payoutEvent({ at: "2026-10-03T01:00:00Z" }), lookup);
    await recordStripePayout(
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
    await recordStripePayout(
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
    await recordStripePayout(db, payoutEvent({ at: "2026-10-03T01:00:00Z" }), lookup);
    await db.update(stripePayouts).set({ deletedAt: new Date("2026-10-04T00:00:00Z") });
    expect(await latestShopPayouts(db, ctx.shop.id)).toEqual({ paid: null, failed: null });
  });
});
