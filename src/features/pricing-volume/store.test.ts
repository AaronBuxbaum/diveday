import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordCheckoutCollection, recordCollectionBalance } from "@/db/collection-ledger";
import {
  bookingCheckouts,
  bookings,
  collectionEntries,
  people,
  pricingVolumeStatements,
  shops,
  trips,
} from "@/db/schema";
import { unseededTestDb } from "@/test/db";
import {
  billableWindow,
  closePricingMonth,
  collectionCurrencies,
  latestPricingStatement,
  markPricingStatementReported,
  meterIdentifier,
  pricingMonthsToClose,
  processedVolumeCents,
} from "./store";

const JUNE = { year: 2031, month: 6 };
const JULY = { year: 2031, month: 7 };
const AUGUST = { year: 2031, month: 8 };
const ZONE = "America/New_York";
const TERMS = { plan: "percent_of_volume", monthlyCents: 0, basisPoints: 300 } as const;
afterEach(() => vi.unstubAllEnvs());

async function fixture() {
  const db = await unseededTestDb();
  const [shop] = await db
    .insert(shops)
    .values({ name: "Volume Shop", slug: "volume-shop", timezone: ZONE })
    .returning();
  if (!shop) throw new Error("shop missing");
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Payer" })
    .returning();
  if (!person) throw new Error("person missing");
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Reef",
      startsAt: new Date("2031-09-01T12:00:00Z"),
      endsAt: new Date("2031-09-01T15:00:00Z"),
      capacity: 8,
    })
    .returning();
  if (!trip) throw new Error("trip missing");
  const [booking] = await db
    .insert(bookings)
    .values({ shopId: shop.id, personId: person.id, tripId: trip.id, bookedAs: "diver" })
    .returning();
  if (!booking) throw new Error("booking missing");
  async function hold(
    balanceCents: number,
    at: string,
    options: { currency?: string; restore?: boolean } = {},
  ) {
    vi.stubEnv("DIVEDAY_CLOCK", at);
    await db.transaction((tx) =>
      recordCollectionBalance(tx, {
        shopId: shop.id,
        sourceType: "booking",
        sourceId: booking.id,
        currency: options.currency ?? "usd",
        method: "cash",
        balanceCents,
        restore: options.restore,
        evidence: {},
      }),
    );
  }
  async function close(
    month: { year: number; month: number },
    basisPoints = 300,
    freeUntil: Date | null = null,
    currency = "usd",
  ) {
    vi.stubEnv("DIVEDAY_CLOCK", "2031-10-02T12:00:00Z");
    return closePricingMonth(db, {
      shopId: shop.id,
      month,
      timeZone: ZONE,
      terms: { ...TERMS, basisPoints },
      freeUntil,
      currency,
    });
  }
  return { db, shop, booking, hold, close };
}

describe("recorded collection volume", () => {
  it("counts the recorded deposit and later balance in their own months, not booking value", async () => {
    const f = await fixture();
    await f.hold(3_000, "2031-06-15T12:00:00Z");
    await f.hold(10_000, "2031-07-15T12:00:00Z");
    expect(await processedVolumeCents(f.db, f.shop.id, JUNE, ZONE)).toBe(3_000);
    expect(await processedVolumeCents(f.db, f.shop.id, JULY, ZONE)).toBe(7_000);
  });
  it("uses the shop-local month and excludes collections during free time", async () => {
    const f = await fixture();
    await f.hold(1_000, "2031-06-01T03:59:00Z");
    await f.hold(3_000, "2031-06-15T12:00:00Z");
    await f.hold(5_000, "2031-06-20T12:00:00Z");
    expect(
      await processedVolumeCents(f.db, f.shop.id, JUNE, ZONE, new Date("2031-06-16T00:00:00Z")),
    ).toBe(2_000);
    expect(billableWindow(JUNE, ZONE, null)).toEqual({
      from: new Date("2031-06-01T04:00:00Z"),
      to: new Date("2031-07-01T04:00:00Z"),
    });
  });
  it("nets same-month refunds before rounding the month's fee once", async () => {
    const f = await fixture();
    await f.hold(10_050, "2031-06-15T12:00:00Z");
    await f.hold(9_050, "2031-06-20T12:00:00Z");
    expect(await f.close(JUNE)).toMatchObject({
      volumeCents: 9_050,
      grossFeeCents: 272,
      feeCents: 272,
      currency: "usd",
    });
  });
  it("holds incomplete checkout evidence and keeps the original receipt month when it arrives late", async () => {
    const f = await fixture();
    const [checkout] = await f.db
      .insert(bookingCheckouts)
      .values({
        shopId: f.shop.id,
        tripId: f.booking.tripId,
        status: "completed",
        currency: "usd",
        stripeAccountId: "acct_late",
        stripeSessionId: "cs_late",
        totalCents: 10_000,
        amountPerDiverCents: 10_000,
        completedAt: new Date("2031-06-25T12:00:00Z"),
      })
      .returning();
    if (!checkout) throw new Error("checkout missing");
    await expect(f.close(JUNE, 300, new Date("2031-06-20T00:00:00Z"))).rejects.toThrow(
      "pricing_close_incomplete_settlement",
    );
    vi.stubEnv("DIVEDAY_CLOCK", "2031-07-15T12:00:00Z");
    await f.db
      .update(bookingCheckouts)
      .set({ settledTotalCents: 10_000, taxCents: 0 })
      .where(eq(bookingCheckouts.id, checkout.id));
    await f.db.transaction((tx) => recordCheckoutCollection(tx, f.shop.id, checkout.id));
    const [entry] = await f.db.select().from(collectionEntries);
    expect(entry).toMatchObject({
      recordedAt: new Date("2031-06-25T12:00:00Z"),
      createdAt: new Date("2031-07-15T12:00:00Z"),
    });
    expect(await f.close(JUNE, 300, new Date("2031-06-20T00:00:00Z"))).toMatchObject({
      volumeCents: 10_000,
      feeCents: 300,
    });
    expect(await f.close(JULY, 100)).toMatchObject({ volumeCents: 0, feeCents: 0 });
  });

  it("keeps statements and their lot allocation unchanged on retry", async () => {
    const f = await fixture();
    await f.hold(10_000, "2031-06-15T12:00:00Z");
    const first = await f.close(JUNE);
    await f.hold(5_000, "2031-07-15T12:00:00Z");
    expect(await f.close(JUNE)).toEqual(first);
    await markPricingStatementReported(f.db, first.id, new Date("2031-10-02T12:01:00Z"));
    expect((await latestPricingStatement(f.db, f.shop.id))?.reportedAt).toEqual(
      new Date("2031-10-02T12:01:00Z"),
    );
  });
  it("never guesses an exchange rate or rewrites a source's currency", async () => {
    const f = await fixture();
    await f.hold(5_000, "2031-06-15T12:00:00Z", { currency: "jpy" });
    expect(await collectionCurrencies(f.db, f.shop.id)).toEqual(["jpy", "usd"]);
    expect(await f.close(JUNE, 300, null, "jpy")).toMatchObject({
      currency: "jpy",
      volumeCents: 5_000,
      feeCents: 150,
    });
    expect(await f.close(JUNE)).toMatchObject({ currency: "usd", volumeCents: 0, feeCents: 0 });
    await expect(f.hold(6_000, "2031-07-15T12:00:00Z")).rejects.toThrow(
      "collection_ledger_currency_changed",
    );
    expect(meterIdentifier(f.shop.id, JUNE, "jpy")).toContain("2031-06-jpy");
  });
});

describe("original-rate refund fee credits", () => {
  it("credits a late refund at the old rate even if the new rate is lower", async () => {
    const f = await fixture();
    await f.hold(10_000, "2031-06-15T12:00:00Z");
    const june = await f.close(JUNE, 300);
    await f.hold(5_000, "2031-07-15T12:00:00Z");
    const july = await f.close(JULY, 100);
    expect(july).toMatchObject({
      volumeCents: 0,
      refundCreditCents: 150,
      feeCents: 0,
      feeCreditCarryCents: 150,
      credits: [{ statementId: june.id, basisCents: 5_000, feeCents: 150 }],
    });
    await f.hold(15_000, "2031-08-15T12:00:00Z");
    expect(await f.close(AUGUST, 100)).toMatchObject({
      volumeCents: 10_000,
      grossFeeCents: 100,
      feeCents: 0,
      feeCreditCarryCents: 50,
      credits: [],
    });
  });
  it("credits the original rounded fee exactly once after repeated partial refunds", async () => {
    const f = await fixture();
    await f.hold(17, "2031-06-15T12:00:00Z");
    expect(await f.close(JUNE)).toMatchObject({ feeCents: 1 });
    await f.hold(10, "2031-07-15T12:00:00Z");
    expect(await f.close(JULY)).toMatchObject({ refundCreditCents: 1, feeCreditCarryCents: 1 });
    await f.hold(0, "2031-08-15T12:00:00Z");
    expect(await f.close(AUGUST)).toMatchObject({
      refundCreditCents: 1,
      credits: [expect.objectContaining({ basisCents: 10, feeCents: 0 })],
    });
  });
  it("does not credit free-period money or imported history", async () => {
    const f = await fixture();
    await f.hold(10_000, "2031-06-15T12:00:00Z");
    await f.close(JUNE, 300, new Date("2031-07-01T00:00:00Z"));
    await f.hold(0, "2031-07-15T12:00:00Z");
    expect(await f.close(JULY)).toMatchObject({ refundCreditCents: 0, feeCents: 0, credits: [] });
  });
  it("undoes a failed refund's credit at the original rate rather than treating it as a new sale", async () => {
    const f = await fixture();
    await f.hold(10_000, "2031-06-15T12:00:00Z");
    await f.close(JUNE, 300);
    await f.hold(5_000, "2031-07-15T12:00:00Z");
    await f.close(JULY, 100);
    await f.hold(10_000, "2031-08-15T12:00:00Z", { restore: true });
    const august = await f.close(AUGUST, 100);
    expect(august).toMatchObject({
      volumeCents: 0,
      refundCreditCents: 0,
      feeCents: 0,
      feeCreditCarryCents: 0,
      credits: [expect.objectContaining({ feeCents: -150, basisCents: -5_000 })],
    });
  });
  it("recovers only the consumed credit when a failed refund restores the original collection", async () => {
    const f = await fixture();
    await f.hold(10_000, "2031-06-15T12:00:00Z");
    await f.close(JUNE, 300);
    await f.hold(5_000, "2031-07-15T12:00:00Z");
    await f.hold(10_000, "2031-07-20T12:00:00Z");
    expect(await f.close(JULY, 100)).toMatchObject({
      grossFeeCents: 50,
      feeCents: 0,
      feeCreditCarryCents: 100,
    });
    await f.hold(15_000, "2031-08-15T12:00:00Z", { restore: true });
    expect(await f.close(AUGUST, 100)).toMatchObject({
      volumeCents: 0,
      refundCreditCents: -50,
      feeCents: 50,
      feeCreditCarryCents: 0,
    });
  });

  it("does not let old unreported native statements starve current accounting after two years", async () => {
    const f = await fixture();
    for (let year = 2028; year <= 2030; year += 1)
      for (let month = 1; month <= 12; month += 1) {
        const key = `${year}-${String(month).padStart(2, "0")}-01`;
        await f.db.insert(pricingVolumeStatements).values({
          shopId: f.shop.id,
          month: key,
          currency: "jpy",
          volumeCents: 100,
          basisPoints: 300,
          feeCents: 3,
          stripeMeterIdentifier: `held-${key}`,
        });
      }
    const months = await pricingMonthsToClose(f.db, f.shop.id, "jpy", JUNE, ZONE);
    expect(months).toContainEqual(JUNE);
    expect(months.length).toBeLessThanOrEqual(24);
  });

  it("keeps an incomplete old-currency receipt visible after the shop changes currency", async () => {
    const f = await fixture();
    const [trip] = await f.db.select().from(trips).where(eq(trips.shopId, f.shop.id)).limit(1);
    if (!trip) throw new Error("trip missing");
    await f.db.insert(bookingCheckouts).values({
      shopId: f.shop.id,
      tripId: trip.id,
      stripeAccountId: "acct_old",
      stripeSessionId: "cs_old",
      currency: "jpy",
      status: "completed",
      completedAt: new Date("2031-06-20T00:00:00Z"),
      totalCents: 5_000,
      amountPerDiverCents: 5_000,
    });
    expect(await collectionCurrencies(f.db, f.shop.id)).toEqual(["jpy", "usd"]);
  });

  it("refuses to leap over an earlier billable collection without a statement", async () => {
    const f = await fixture();
    await f.hold(10_000, "2031-06-15T12:00:00Z");
    await expect(f.close(JULY)).rejects.toThrow("pricing_close_missing_earlier_month");
    expect(await f.db.select().from(pricingVolumeStatements)).toHaveLength(0);
    await f.close(JUNE);
    expect(await f.close(JULY)).toMatchObject({ feeCents: 0 });
  });

  it("refuses to close backwards or close an unfinished month", async () => {
    const f = await fixture();
    await f.close(JULY);
    await expect(f.close(JUNE)).rejects.toThrow("pricing_close_out_of_order");
    vi.stubEnv("DIVEDAY_CLOCK", "2031-08-15T12:00:00Z");
    await expect(
      closePricingMonth(f.db, {
        shopId: f.shop.id,
        month: AUGUST,
        timeZone: ZONE,
        terms: TERMS,
        freeUntil: null,
      }),
    ).rejects.toThrow("pricing_close_month_not_finished");
    expect(await f.db.select().from(pricingVolumeStatements)).toHaveLength(1);
    expect(
      await f.db.select().from(collectionEntries).where(eq(collectionEntries.shopId, f.shop.id)),
    ).toHaveLength(0);
  });
});
