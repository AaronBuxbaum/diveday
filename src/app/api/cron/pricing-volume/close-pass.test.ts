import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { latestPricingStatement } from "@/db/pricing-volume";
import {
  orderLineItems,
  orders,
  people,
  pricingVolumeStatements,
  shopSubscriptions,
  shops,
  userAccounts,
} from "@/db/schema";
import { DEFAULT_PRICING_CONFIG } from "@/lib/billing/pricing-plans";
import { unseededTestDb } from "@/test/db";
import { closePercentMonths, lastClosedMonth } from "./close-pass";

/**
 * The percent plan's monthly close (ADR 20261022-pricing-ab-test), against a
 * real shop in UTC, created well before June 2031 so its trial is over.
 */
const NOW = new Date("2031-07-02T14:13:00Z");
const ON = { ...DEFAULT_PRICING_CONFIG, test: true };
const PERCENT = { priceId: "price_metered", meterEventName: "diveday_fee_cents" };
let seq = 0;

async function percentShop(
  db: AppDb,
  overrides: Partial<typeof shopSubscriptions.$inferInsert> = {},
  shop: { isDemo?: boolean } = {},
) {
  seq += 1;
  const [row] = await db
    .insert(shops)
    .values({
      name: "Close Shop",
      slug: `close-shop-${seq}`,
      timezone: "UTC",
      isDemo: shop.isDemo ?? false,
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
      currency: "usd",
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
  return row.id;
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
      identifier: `diveday-fee-${shopId}-2031-06`,
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
      expect.objectContaining({ valueCents: 3_000, identifier: `diveday-fee-${shopId}-2031-06` }),
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
      expect.objectContaining({ identifier: `diveday-fee-${shopId}-2031-06`, value: 3_000 }),
    ]);
  });

  it("bills a percent shop's final month up to the cancel, on what it was sold", async () => {
    const db = await unseededTestDb();
    // Canceled on 20 June, with the test switched off since: the snapshot still holds.
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
      identifier: `diveday-fee-${shopId}-2031-06`,
      month: "2031-06",
    });
    expect(provider.reportMeterEvent).not.toHaveBeenCalled();
    expect((await latestPricingStatement(db, shopId))?.reportedAt).toEqual(NOW);
    // Run again, and the month after: nothing more is billed.
    await closePercentMonths(db, options);
    await closePercentMonths(db, { ...options, now: new Date("2031-08-02T14:08:00Z") });
    expect(provider.invoiceFinalMonth).toHaveBeenCalledTimes(1);
    expect(await db.select().from(pricingVolumeStatements)).toHaveLength(1);
  });

  it("counts only the money taken before the cancel, and skips a subscription that ended earlier", async () => {
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
    ).toMatchObject({ closed: 1, nothingToReport: 1, finalMonths: 0 });
    expect(provider.invoiceFinalMonth).not.toHaveBeenCalled();
    expect(await latestPricingStatement(db, after)).toMatchObject({ volumeCents: 0, feeCents: 0 });
  });
});
