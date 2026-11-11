import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { recordCheckoutCollection, recordOrderCollection } from "@/db/collection-ledger";
import {
  bookingCheckouts,
  collectionEntries,
  orderLineItems,
  orders,
  people,
  pricingVolumeStatements,
  shopSubscriptions,
  shops,
  trips,
  userAccounts,
} from "@/db/schema";
import { DEFAULT_PRICING_CONFIG } from "@/lib/billing/pricing-plans";
import { unseededTestDb } from "@/test/db";
import { latestPricingStatement } from "../../../../features/pricing-volume/store";
import { closePercentMonths, lastClosedMonth } from "./close-pass";

/**
 * The percent plan's monthly close (ADR 20261022-pricing-ab-test), against a
 * real shop in UTC, created well before June 2031 so its trial is over.
 */
const NOW = new Date("2031-07-02T14:13:00Z");
const ON = { monthlyCents: 0, basisPoints: 300 };
const PERCENT = { priceId: "price_metered", meterEventName: "diveday_fee_cents" };
let seq = 0;

async function percentShop(
  db: AppDb,
  overrides: Partial<typeof shopSubscriptions.$inferInsert> = {},
  shop: { isDemo?: boolean; currency?: "usd" | "jpy" } = {},
) {
  seq += 1;
  const [row] = await db
    .insert(shops)
    .values({
      name: "Close Shop",
      slug: `close-shop-${seq}`,
      timezone: "UTC",
      isDemo: shop.isDemo ?? false,
      currency: shop.currency ?? "usd",
      createdAt: new Date("2031-01-01T00:00:00Z"),
    })
    .returning();
  if (!row) throw new Error("shop insert failed");
  const [owner] = await db.insert(people).values({ shopId: row.id, fullName: "Owner" }).returning();
  if (!owner) throw new Error("person insert failed");
  await db
    .insert(userAccounts)
    .values({ personId: owner.id, email: `close-${seq}@example.test`, hashedPassword: "x" });
  await db.insert(shopSubscriptions).values({
    shopId: row.id,
    stripeCustomerId: `cus_close_${seq}`,
    stripeSubscriptionId: `sub_close_${seq}`,
    stripeStatus: "active",
    pricingPlan: "percent_of_volume",
    pricingPlanSource: "assigned",
    planMonthlyCents: 0,
    planBasisPoints: 300,
    ...overrides,
  });
  // $1,000 of rentals paid through DiveDay in June.
  const [order] = await db
    .insert(orders)
    .values({
      shopId: row.id,
      personId: owner.id,
      createdByPersonId: owner.id,
      status: "paid",
      currency: shop.currency ?? "usd",
      totalCents: 100_000,
      taxCents: 0,
      amountPaidCents: 100_000,
      refundedCents: 0,
      stripeAccountId: "acct_close",
      stripeCustomerId: `cus_conn_${seq}`,
      stripeInvoiceId: `in_close_${seq}`,
      paidAt: new Date("2031-06-15T12:00:00Z"),
    })
    .returning();
  if (!order) throw new Error("order insert failed");
  await db.insert(orderLineItems).values({
    shopId: row.id,
    orderId: order.id,
    kind: "rental",
    description: "rental",
    quantity: 1,
    unitAmountCents: 100_000,
  });
  vi.stubEnv("DIVEDAY_CLOCK", "2031-06-15T12:00:00Z");
  await db.transaction((tx) => recordOrderCollection(tx, row.id, order.id));
  vi.unstubAllEnvs();
  return row.id;
}

async function unconfirmedMay(db: AppDb, shopId: string, withKnownMayReceipt: boolean) {
  const [source] = await db.select().from(orders).where(eq(orders.shopId, shopId)).limit(1);
  if (!source) throw new Error("order missing");
  if (withKnownMayReceipt) {
    const [known] = await db
      .insert(orders)
      .values({
        shopId,
        personId: source.personId,
        createdByPersonId: source.createdByPersonId,
        currency: "usd",
        collection: "cash",
        status: "paid",
        totalCents: 10_000,
        amountPaidCents: 10_000,
        paidAt: new Date("2031-05-15T12:00:00Z"),
      })
      .returning();
    if (!known) throw new Error("order missing");
    await db.insert(collectionEntries).values({
      shopId,
      sourceType: "order",
      sourceId: known.id,
      currency: "usd",
      method: "cash",
      amountCents: 10_000,
      recordedAt: new Date("2031-05-15T12:00:00Z"),
      evidence: {},
    });
  }
  const [trip] = await db
    .insert(trips)
    .values({
      shopId,
      title: "Unconfirmed receipt",
      startsAt: new Date("2031-06-20T12:00:00Z"),
      endsAt: new Date("2031-06-20T15:00:00Z"),
      capacity: 8,
    })
    .returning();
  if (!trip) throw new Error("trip missing");
  const [checkout] = await db
    .insert(bookingCheckouts)
    .values({
      shopId,
      tripId: trip.id,
      stripeAccountId: "acct_close",
      stripeSessionId: `cs_missing_${shopId}`,
      status: "completed",
      completedAt: new Date("2031-05-20T12:00:00Z"),
      currency: "usd",
      totalCents: 50_000,
      amountPerDiverCents: 50_000,
    })
    .returning();
  if (!checkout) throw new Error("checkout missing");
  return checkout;
}

function fakeProvider(status: "ok" | "failed" = "ok") {
  return {
    reportMeterEvent: vi.fn(async () =>
      status === "ok"
        ? ({ status: "ok", value: "reported" } as const)
        : ({ status: "failed" } as const),
    ),
    meterValueReported: vi.fn(async () => ({ status: "ok", value: 0 }) as const),
    invoiceFinalMonth: vi.fn(async () => ({ status: "ok", value: "invoiced" }) as const),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Stripe's meter as the docs describe it: an identifier is unique for exactly
 * 24 hours and no longer, and a summary sums what was recorded. `lose` drops
 * the next answers after the event is recorded, as a timed-out call would.
 */
function fakeStripe() {
  const state = { now: NOW, lose: 0, summary: "ok" as "ok" | "failed" };
  const events: { identifier: string; at: Date; value: number }[] = [];
  const provider = {
    reportMeterEvent: vi.fn(
      async (input: { identifier: string; valueCents: number; customerId: string }) => {
        const held = events.some(
          (event) =>
            event.identifier === input.identifier &&
            state.now.getTime() - event.at.getTime() < DAY_MS,
        );
        if (!held)
          events.push({ identifier: input.identifier, at: state.now, value: input.valueCents });
        if (state.lose > 0) {
          state.lose -= 1;
          return { status: "failed" } as const;
        }
        return { status: "ok", value: "reported" } as const;
      },
    ),
    meterValueReported: vi.fn(async () =>
      state.summary === "ok"
        ? ({ status: "ok", value: events.reduce((sum, event) => sum + event.value, 0) } as const)
        : ({ status: "failed" } as const),
    ),
    invoiceFinalMonth: vi.fn(async () => ({ status: "ok", value: "invoiced" }) as const),
  };
  return { state, events, provider };
}

describe("lastClosedMonth", () => {
  it("is the month before the shop's own today", () => {
    expect(lastClosedMonth(NOW, "UTC")).toEqual({ year: 2031, month: 6 });
    expect(lastClosedMonth(new Date("2031-01-02T00:00:00Z"), "UTC")).toEqual({
      year: 2030,
      month: 12,
    });
    // 03:00Z on 1 July is still 30 June in Key Largo: May has closed, not June.
    expect(lastClosedMonth(new Date("2031-07-01T03:00:00Z"), "America/New_York")).toEqual({
      year: 2031,
      month: 5,
    });
  });
});

describe("closePercentMonths", () => {
  it("writes the month's statement, reports its fee once, and is a no-op run again", async () => {
    const db = await unseededTestDb();
    const shopId = await percentShop(db);
    const provider = fakeProvider();
    const options = { now: NOW, config: ON, provider, percent: PERCENT };

    const first = await closePercentMonths(db, options);
    expect(first).toMatchObject({ closed: 1, reported: 1, failed: 0 });
    expect(provider.reportMeterEvent).toHaveBeenCalledTimes(1);
    expect(provider.reportMeterEvent).toHaveBeenCalledWith({
      eventName: "diveday_fee_cents",
      customerId: expect.stringMatching(/^cus_close_/),
      valueCents: 3_000,
      identifier: `diveday-fee-${shopId}-2031-06-usd`,
      timestamp: new Date("2031-06-30T23:59:00Z"),
    });
    const statement = await latestPricingStatement(db, shopId);
    expect(statement).toMatchObject({ volumeCents: 100_000, feeCents: 3_000, basisPoints: 300 });
    expect(statement?.reportedAt).toEqual(NOW);

    const second = await closePercentMonths(db, {
      ...options,
      now: new Date("2031-07-03T14:13:00Z"),
    });
    expect(second).toMatchObject({ closed: 1, reported: 0, alreadyReported: 1 });
    expect(provider.reportMeterEvent).toHaveBeenCalledTimes(1);
    expect(await db.select().from(pricingVolumeStatements)).toHaveLength(1);
  });

  it("retries a report that failed, with the same figures, and stamps it then", async () => {
    const db = await unseededTestDb();
    const shopId = await percentShop(db);
    const failing = fakeProvider("failed");
    expect(
      await closePercentMonths(db, { now: NOW, config: ON, provider: failing, percent: PERCENT }),
    ).toMatchObject({ failed: 1, reported: 0 });
    expect((await latestPricingStatement(db, shopId))?.reportedAt).toBeNull();
    const working = fakeProvider();
    expect(
      await closePercentMonths(db, { now: NOW, config: ON, provider: working, percent: PERCENT }),
    ).toMatchObject({ reported: 1 });
    expect(working.reportMeterEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        valueCents: 3_000,
        identifier: `diveday-fee-${shopId}-2031-06-usd`,
      }),
    );
  });

  it("writes the statement but reports nothing while the meter is not configured", async () => {
    const db = await unseededTestDb();
    const shopId = await percentShop(db);
    expect(
      await closePercentMonths(db, { now: NOW, config: ON, provider: null, percent: null }),
    ).toMatchObject({ closed: 1, notConfigured: 1 });
    expect((await latestPricingStatement(db, shopId))?.reportedAt).toBeNull();
  });

  it("leaves flat-plan, canceled, demo and card-less shops alone", async () => {
    const db = await unseededTestDb();
    await percentShop(db, {
      pricingPlan: "flat_monthly",
      planMonthlyCents: 9_900,
      planBasisPoints: 0,
    });
    await percentShop(db, { stripeStatus: "canceled" });
    await percentShop(db, {}, { isDemo: true });
    const noCard = await percentShop(db);
    await db
      .update(shopSubscriptions)
      .set({ stripeSubscriptionId: null, stripeStatus: null })
      .where(eq(shopSubscriptions.shopId, noCard));
    const provider = fakeProvider();
    expect(
      await closePercentMonths(db, { now: NOW, config: ON, provider, percent: PERCENT }),
    ).toMatchObject({ closed: 0 });
    expect(provider.reportMeterEvent).not.toHaveBeenCalled();
  });

  it("stamps a month with no fee without calling Stripe", async () => {
    const db = await unseededTestDb();
    const shopId = await percentShop(db, { planBasisPoints: 0 });
    const provider = fakeProvider();
    expect(
      await closePercentMonths(db, { now: NOW, config: ON, provider, percent: PERCENT }),
    ).toMatchObject({ nothingToReport: 1 });
    expect(provider.reportMeterEvent).not.toHaveBeenCalled();
    expect((await latestPricingStatement(db, shopId))?.reportedAt).toEqual(NOW);
  });

  it("never bills twice when a lost answer is retried about 24 hours later", async () => {
    const db = await unseededTestDb();
    const shopId = await percentShop(db);
    const stripe = fakeStripe();
    const run = (now: Date) =>
      closePercentMonths(db, { now, config: ON, provider: stripe.provider, percent: PERCENT });

    stripe.state.now = new Date("2031-07-02T14:08:00Z");
    stripe.state.lose = 1;
    expect(await run(stripe.state.now)).toMatchObject({ failed: 1 });
    expect((await latestPricingStatement(db, shopId))?.reportedAt).toBeNull();

    // A day and a minute on, past Stripe's 24-hour window: the meter is asked
    // first, holds the fee, and the statement is stamped with nothing re-sent.
    stripe.state.now = new Date("2031-07-03T14:09:00Z");
    expect(await run(stripe.state.now)).toMatchObject({ reconciled: 1, failed: 0 });
    expect(stripe.events).toHaveLength(1);
    expect(stripe.provider.reportMeterEvent).toHaveBeenCalledTimes(1);
    expect(stripe.provider.meterValueReported).toHaveBeenCalledWith({
      priceId: PERCENT.priceId,
      customerId: expect.stringMatching(/^cus_close_/),
      from: new Date("2031-06-01T00:00:00Z"),
      to: new Date("2031-07-01T00:00:00Z"),
    });
    expect((await latestPricingStatement(db, shopId))?.reportedAt).toEqual(stripe.state.now);
  });

  it("re-sends within the hours after a lost answer, where Stripe dedupes the identifier", async () => {
    const db = await unseededTestDb();
    await percentShop(db);
    const stripe = fakeStripe();
    const run = (now: Date) =>
      closePercentMonths(db, { now, config: ON, provider: stripe.provider, percent: PERCENT });
    stripe.state.now = new Date("2031-07-02T14:08:00Z");
    stripe.state.lose = 1;
    await run(stripe.state.now);
    stripe.state.now = new Date("2031-07-02T18:08:00Z");
    expect(await run(stripe.state.now)).toMatchObject({ reported: 1 });
    expect(stripe.provider.meterValueReported).not.toHaveBeenCalled();
    expect(stripe.events).toHaveLength(1);
  });

  it("sends a stale attempt the meter never got, and holds one it cannot check", async () => {
    const db = await unseededTestDb();
    const shopId = await percentShop(db);
    const failing = fakeProvider("failed");
    await closePercentMonths(db, {
      now: new Date("2031-07-02T14:08:00Z"),
      config: ON,
      provider: failing,
      percent: PERCENT,
    });
    const stripe = fakeStripe();
    stripe.state.now = new Date("2031-07-03T14:09:00Z");
    stripe.state.summary = "failed";
    expect(
      await closePercentMonths(db, {
        now: stripe.state.now,
        config: ON,
        provider: stripe.provider,
        percent: PERCENT,
      }),
    ).toMatchObject({ failed: 1, reported: 0 });
    expect(stripe.provider.reportMeterEvent).not.toHaveBeenCalled();
    stripe.state.summary = "ok";
    expect(
      await closePercentMonths(db, {
        now: stripe.state.now,
        config: ON,
        provider: stripe.provider,
        percent: PERCENT,
      }),
    ).toMatchObject({ reported: 1 });
    expect(stripe.events).toEqual([
      expect.objectContaining({ identifier: `diveday-fee-${shopId}-2031-06-usd`, value: 3_000 }),
    ]);
  });

  it("bills a percent shop's final month up to the cancel, on what it was sold", async () => {
    const db = await unseededTestDb();
    // Canceled on 20 June, with the public offer changed since: the snapshot still holds.
    const shopId = await percentShop(db, {
      stripeStatus: "canceled",
      lastSubscriptionEventAt: new Date("2031-06-20T00:00:00Z"),
    });
    const provider = fakeProvider();
    const options = { now: NOW, config: DEFAULT_PRICING_CONFIG, provider, percent: PERCENT };
    expect(await closePercentMonths(db, options)).toMatchObject({ finalMonths: 1, closed: 1 });
    expect(provider.invoiceFinalMonth).toHaveBeenCalledWith({
      customerId: expect.stringMatching(/^cus_close_/),
      amountCents: 3_000,
      identifier: `diveday-fee-${shopId}-2031-06-usd`,
      month: "2031-06",
    });
    expect(provider.reportMeterEvent).not.toHaveBeenCalled();
    expect((await latestPricingStatement(db, shopId))?.reportedAt).toEqual(NOW);
    // Run again, and the month after: nothing more is billed.
    await closePercentMonths(db, options);
    await closePercentMonths(db, { ...options, now: new Date("2031-08-02T14:08:00Z") });
    expect(provider.invoiceFinalMonth).toHaveBeenCalledTimes(1);
    expect(await db.select().from(pricingVolumeStatements)).toHaveLength(2);
  });

  it("counts only money before cancellation and retains later statements for refund credits", async () => {
    const db = await unseededTestDb();
    // The June order is paid on the 15th, after a cancel on the 10th.
    const after = await percentShop(db, {
      stripeStatus: "canceled",
      lastSubscriptionEventAt: new Date("2031-06-10T00:00:00Z"),
    });
    await percentShop(db, {
      stripeStatus: "canceled",
      lastSubscriptionEventAt: new Date("2031-05-20T00:00:00Z"),
    });
    const provider = fakeProvider();
    expect(
      await closePercentMonths(db, { now: NOW, config: ON, provider, percent: PERCENT }),
    ).toMatchObject({ closed: 2, nothingToReport: 2, finalMonths: 0 });
    expect(provider.invoiceFinalMonth).not.toHaveBeenCalled();
    expect(await latestPricingStatement(db, after)).toMatchObject({ volumeCents: 0, feeCents: 0 });
  });
  it("catches up a missed month before closing the newer one", async () => {
    const db = await unseededTestDb();
    await percentShop(db);
    const provider = fakeProvider();
    const summary = await closePercentMonths(db, {
      now: new Date("2031-08-02T14:08:00Z"),
      config: ON,
      provider,
      percent: PERCENT,
    });
    expect(summary).toMatchObject({ closed: 2, reported: 1, nothingToReport: 1 });
    expect(
      (await db.select().from(pricingVolumeStatements)).map((row) => row.month).sort(),
    ).toEqual(["2031-06-01", "2031-07-01"]);
  });

  it("holds native JPY fees instead of sending yen to the dollar meter", async () => {
    const db = await unseededTestDb();
    const shopId = await percentShop(db, {}, { currency: "jpy" });
    const provider = fakeProvider();
    expect(
      await closePercentMonths(db, { now: NOW, config: ON, provider, percent: PERCENT }),
    ).toMatchObject({ closed: 1, notConfigured: 1, reported: 0 });
    expect(provider.reportMeterEvent).not.toHaveBeenCalled();
    expect(provider.invoiceFinalMonth).not.toHaveBeenCalled();
    expect(await latestPricingStatement(db, shopId)).toMatchObject({
      currency: "jpy",
      volumeCents: 100_000,
      feeCents: 3_000,
      reportedAt: null,
    });
  });
  it("does not hold a paid month for an unknown receipt from an already free period", async () => {
    const db = await unseededTestDb();
    const shopId = await percentShop(db, { freeTermEndsOn: "2031-06-20" });
    await unconfirmedMay(db, shopId, false);
    await db
      .update(collectionEntries)
      .set({ recordedAt: new Date("2031-07-15T12:00:00Z") })
      .where(eq(collectionEntries.shopId, shopId));
    const provider = fakeProvider();
    const result = await closePercentMonths(db, {
      now: new Date("2031-08-02T12:00:00Z"),
      config: ON,
      provider,
      percent: PERCENT,
    });
    expect(result).toMatchObject({ closed: 3, failed: 0, reported: 1 });
    expect(
      (await db.select().from(pricingVolumeStatements)).find((row) => row.month === "2031-07-01"),
    ).toMatchObject({ volumeCents: 100_000, feeCents: 3_000 });
  });

  it("does not skip a failed earlier close and can catch it up after exact evidence arrives", async () => {
    const db = await unseededTestDb();
    const shopId = await percentShop(db);
    const checkout = await unconfirmedMay(db, shopId, true);
    const provider = fakeProvider();
    const options = { now: NOW, config: ON, provider, percent: PERCENT };
    expect(await closePercentMonths(db, options)).toMatchObject({ closed: 0, failed: 1 });
    expect(await db.select().from(pricingVolumeStatements)).toHaveLength(0);
    await db
      .update(bookingCheckouts)
      .set({ settledTotalCents: 50_000, taxCents: 0 })
      .where(eq(bookingCheckouts.id, checkout.id));
    await db.transaction((tx) => recordCheckoutCollection(tx, shopId, checkout.id));
    expect(await closePercentMonths(db, options)).toMatchObject({ closed: 2, reported: 2 });
    expect(
      (await db.select().from(pricingVolumeStatements)).map((row) => row.month).sort(),
    ).toEqual(["2031-05-01", "2031-06-01"]);
  });

  it("holds the earliest incomplete receipt even when it has no collection lot yet", async () => {
    const db = await unseededTestDb();
    const shopId = await percentShop(db);
    await unconfirmedMay(db, shopId, false);
    const provider = fakeProvider();
    expect(
      await closePercentMonths(db, { now: NOW, config: ON, provider, percent: PERCENT }),
    ).toMatchObject({ closed: 0, failed: 1 });
    expect(provider.reportMeterEvent).not.toHaveBeenCalled();
    expect(await db.select().from(pricingVolumeStatements)).toHaveLength(0);
  });
});
