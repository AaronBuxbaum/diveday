import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import { markCheckoutPaidBySessionId } from "./checkouts";
import {
  recordCheckoutCollection,
  recordCollectionBalance,
  recordOrderCollection,
} from "./collection-ledger";
import { getBookingPayment, setBookingPayment } from "./payments";
import {
  bookingCheckouts,
  bookings,
  collectionEntries,
  orders,
  people,
  shops,
  trips,
} from "./schema";

async function fixture() {
  const db = await unseededTestDb();
  const [shop] = await db
    .insert(shops)
    .values({ name: "Collection Shop", slug: "collection-shop", timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("missing shop");
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Payer" })
    .returning();
  if (!person) throw new Error("missing person");
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Reef",
      startsAt: new Date("2031-06-20T12:00:00Z"),
      endsAt: new Date("2031-06-20T15:00:00Z"),
      capacity: 8,
    })
    .returning();
  if (!trip) throw new Error("missing trip");
  const [booking] = await db
    .insert(bookings)
    .values({
      shopId: shop.id,
      tripId: trip.id,
      personId: person.id,
      bookedAs: "diver",
      status: "booked",
    })
    .returning();
  if (!booking) throw new Error("missing booking");
  return { db, shop, person, booking };
}

describe("received-money collection ledger", () => {
  it("records hand-marked deposits and balances once, then links refunds to the lots", async () => {
    const { db, shop, booking } = await fixture();
    const mark = {
      shopId: shop.id,
      bookingId: booking.id,
      currency: "usd",
      method: "cash" as const,
    };
    await setBookingPayment(db, { ...mark, status: "deposit_paid", amountCents: 3_000 });
    await setBookingPayment(db, { ...mark, status: "deposit_paid", amountCents: 3_000 });
    await setBookingPayment(db, { ...mark, status: "paid", amountCents: 10_000 });
    await setBookingPayment(db, { ...mark, status: "partly_refunded", amountCents: 2_000 });
    const entries = await db.select().from(collectionEntries);
    expect(entries.map((row) => row.amountCents)).toEqual([3_000, 7_000, -7_000, -1_000]);
    expect(entries[2]?.reversesEntryId).toBe(entries[1]?.id);
    expect(entries[3]?.reversesEntryId).toBe(entries[0]?.id);
    expect(entries.reduce((sum, row) => sum + row.amountCents, 0)).toBe(2_000);
  });

  it("never bills seat cascades or package redemptions as another collection", async () => {
    const { db, shop, booking } = await fixture();
    for (const provider of ["stripe", "dive_package", "cash"]) {
      await setBookingPayment(db, {
        shopId: shop.id,
        bookingId: booking.id,
        status: "paid",
        amountCents: 10_000,
        currency: "usd",
        provider,
      });
    }
    expect(await db.select().from(collectionEntries)).toEqual([]);
  });

  it("counts actual external money, excludes recorded tax and pass-through, and deduplicates a retry", async () => {
    const { db, shop, person } = await fixture();
    const [order] = await db
      .insert(orders)
      .values({
        shopId: shop.id,
        personId: person.id,
        createdByPersonId: person.id,
        status: "paid",
        collection: "cash",
        currency: "jpy",
        totalCents: 12_000,
        amountPaidCents: 12_000,
        taxCents: 1_000,
        passThroughCents: 1_000,
      })
      .returning();
    if (!order) throw new Error("missing order");
    await db.transaction(async (tx) => {
      await recordOrderCollection(tx, shop.id, order.id);
    });
    await db.transaction(async (tx) => {
      await recordOrderCollection(tx, shop.id, order.id);
    });
    expect(await db.select().from(collectionEntries)).toEqual([
      expect.objectContaining({ amountCents: 10_000, currency: "jpy", method: "cash" }),
    ]);
  });

  it("prorates an invoice deposit and preserves its tax split through a full failed refund", async () => {
    const { db, shop, person } = await fixture();
    const [order] = await db
      .insert(orders)
      .values({
        shopId: shop.id,
        personId: person.id,
        createdByPersonId: person.id,
        status: "open",
        stripeAccountId: "acct_collection",
        stripeCustomerId: "cus_collection",
        stripeInvoiceId: "in_collection",
        currency: "usd",
        totalCents: 12_000,
        amountPaidCents: 3_000,
        taxCents: 1_000,
        passThroughCents: 1_000,
      })
      .returning();
    if (!order) throw new Error("missing order");
    await db.transaction((tx) => recordOrderCollection(tx, shop.id, order.id));
    await db
      .update(orders)
      .set({ status: "paid", amountPaidCents: 12_000 })
      .where(eq(orders.id, order.id));
    await db.transaction((tx) => recordOrderCollection(tx, shop.id, order.id));
    await db
      .update(orders)
      .set({
        status: "refunded",
        amountPaidCents: 0,
        taxCents: 0,
        passThroughCents: 0,
        refundedCents: 12_000,
      })
      .where(eq(orders.id, order.id));
    await db.transaction((tx) => recordOrderCollection(tx, shop.id, order.id));
    await db
      .update(orders)
      .set({ status: "paid", amountPaidCents: 12_000, refundedCents: 0 })
      .where(eq(orders.id, order.id));
    await db.transaction((tx) => recordOrderCollection(tx, shop.id, order.id, true));
    const entries = await db.select().from(collectionEntries);
    expect(entries[0]?.amountCents).toBe(2_500);
    expect(entries.reduce((sum, row) => sum + row.amountCents, 0)).toBe(10_000);
    expect(
      entries.filter((row) => row.amountCents > 0 && row.reversesEntryId !== null),
    ).toHaveLength(2);
  });

  it("excludes the whole protected pass-through fee after a fare discount", async () => {
    const { db, shop, booking } = await fixture();
    const [checkout] = await db
      .insert(bookingCheckouts)
      .values({
        shopId: shop.id,
        tripId: booking.tripId,
        stripeAccountId: "acct_discount",
        stripeSessionId: "cs_discount",
        status: "completed",
        currency: "usd",
        totalCents: 11_000,
        amountPerDiverCents: 10_000,
        passThroughCents: 1_000,
        settledTotalCents: 6_000,
        taxCents: 0,
      })
      .returning();
    if (!checkout) throw new Error("missing checkout");
    await db.transaction((tx) => recordCheckoutCollection(tx, shop.id, checkout.id));
    expect((await db.select().from(collectionEntries))[0]?.amountCents).toBe(5_000);
    await db
      .update(bookingCheckouts)
      .set({ refundedCents: 3_000 })
      .where(eq(bookingCheckouts.id, checkout.id));
    await db.transaction((tx) => recordCheckoutCollection(tx, shop.id, checkout.id));
    expect((await db.select().from(collectionEntries)).map((row) => row.amountCents)).toEqual([
      5_000, -2_500,
    ]);
  });

  it("holds contradictory tax evidence instead of treating its clamp as an exact zero-fee receipt", async () => {
    const { db, shop, booking } = await fixture();
    const [checkout] = await db
      .insert(bookingCheckouts)
      .values({
        shopId: shop.id,
        tripId: booking.tripId,
        stripeAccountId: "acct_tax",
        stripeSessionId: "cs_tax",
        currency: "usd",
        totalCents: 10_000,
        amountPerDiverCents: 10_000,
        taxEnabled: true,
      })
      .returning();
    if (!checkout) throw new Error("checkout missing");
    await markCheckoutPaidBySessionId(db, "cs_tax", "acct_tax", 10_000, 20_000);
    expect(
      (await db.select().from(bookingCheckouts).where(eq(bookingCheckouts.id, checkout.id)))[0]
        ?.collectionNeedsReview,
    ).toBe(true);
    expect(await db.select().from(collectionEntries)).toHaveLength(0);
  });

  it("repairs late tax evidence without reviving an expired checkout or duplicating its receipt", async () => {
    const { db, shop, booking } = await fixture();
    const [checkout] = await db
      .insert(bookingCheckouts)
      .values({
        shopId: shop.id,
        tripId: booking.tripId,
        stripeAccountId: "acct_late_tax",
        stripeSessionId: "cs_late_tax",
        status: "expired",
        currency: "usd",
        totalCents: 10_000,
        amountPerDiverCents: 10_000,
        taxEnabled: true,
      })
      .returning();
    if (!checkout) throw new Error("checkout missing");
    const read = async () =>
      (await db.select().from(bookingCheckouts).where(eq(bookingCheckouts.id, checkout.id)))[0];

    // A tax figure without an exact total is not enough. Later partial or
    // contradictory deliveries may fill in the total but cannot invent tax.
    for (const [total, tax] of [
      [undefined, 1_000],
      [10_000, undefined],
      [10_000, null],
      [10_000, -1],
      [10_000, 1.5],
      [10_000, 20_000],
    ]) {
      expect(
        await markCheckoutPaidBySessionId(db, "cs_late_tax", "acct_late_tax", total, tax),
      ).toBeNull();
      expect(await read()).toMatchObject({
        status: "expired",
        collectionNeedsReview: true,
        taxCents: null,
      });
      expect(await db.select().from(collectionEntries)).toHaveLength(0);
    }
    const firstReceiptAt = (await read())?.paidAfterCloseAt;
    expect(firstReceiptAt).toBeInstanceOf(Date);
    await markCheckoutPaidBySessionId(db, "cs_late_tax", "acct_late_tax", 10_000, 1_000);
    expect(await read()).toMatchObject({
      status: "expired",
      collectionNeedsReview: false,
      paidAfterCloseAt: firstReceiptAt,
      paidAfterCloseCents: 10_000,
      settledTotalCents: 10_000,
      taxCents: 1_000,
    });
    const receipt = await db.select().from(collectionEntries);
    expect(receipt).toHaveLength(1);
    expect(receipt[0]).toMatchObject({
      sourceId: checkout.id,
      currency: "usd",
      amountCents: 9_000,
      recordedAt: firstReceiptAt,
    });

    // Once exact evidence is recorded, a redelivery cannot replace it or
    // append a second collection, even if its reported figures differ.
    await markCheckoutPaidBySessionId(db, "cs_late_tax", "acct_late_tax", 15_000, 2_000);
    expect(await read()).toMatchObject({ settledTotalCents: 10_000, taxCents: 1_000 });
    expect(await db.select().from(collectionEntries)).toEqual(receipt);
    expect((await db.select().from(bookings).where(eq(bookings.id, booking.id)))[0]?.status).toBe(
      "booked",
    );
    expect(await getBookingPayment(db, shop.id, booking.id)).toBeNull();
  });

  it("flags a contradictory completed replay even when its first exact figures cannot change", async () => {
    const { db, shop, booking } = await fixture();
    const [checkout] = await db
      .insert(bookingCheckouts)
      .values({
        shopId: shop.id,
        tripId: booking.tripId,
        stripeAccountId: "acct_replayed_tax",
        stripeSessionId: "cs_replayed_tax",
        status: "completed",
        currency: "usd",
        totalCents: 10_000,
        amountPerDiverCents: 10_000,
        settledTotalCents: 10_000,
        taxCents: 0,
        taxEnabled: true,
      })
      .returning();
    if (!checkout) throw new Error("checkout missing");
    for (const tax of [20_000, 20_000]) {
      await markCheckoutPaidBySessionId(db, "cs_replayed_tax", "acct_replayed_tax", 10_000, tax);
      expect(
        (await db.select().from(bookingCheckouts).where(eq(bookingCheckouts.id, checkout.id)))[0],
      ).toMatchObject({
        status: "completed",
        settledTotalCents: 10_000,
        taxCents: 0,
        collectionNeedsReview: true,
      });
      expect(await db.select().from(collectionEntries)).toHaveLength(0);
    }
  });

  it("holds tax exceeding the quote when the completed event omitted its actual total", async () => {
    const { db, shop, booking } = await fixture();
    const [checkout] = await db
      .insert(bookingCheckouts)
      .values({
        shopId: shop.id,
        tripId: booking.tripId,
        stripeAccountId: "acct_missing_total",
        stripeSessionId: "cs_missing_total",
        currency: "usd",
        totalCents: 10_000,
        amountPerDiverCents: 10_000,
        taxEnabled: true,
      })
      .returning();
    if (!checkout) throw new Error("checkout missing");
    await markCheckoutPaidBySessionId(db, "cs_missing_total", "acct_missing_total", null, 12_000);
    expect(
      (await db.select().from(bookingCheckouts).where(eq(bookingCheckouts.id, checkout.id)))[0],
    ).toMatchObject({
      status: "completed",
      settledTotalCents: null,
      collectionNeedsReview: true,
    });
    expect(await db.select().from(collectionEntries)).toHaveLength(0);
  });

  it("refuses an unknown currency and a source from another shop without a partial append", async () => {
    const { db, shop, booking } = await fixture();
    const [other] = await db
      .insert(shops)
      .values({ name: "Other", slug: "other-collection", timezone: "UTC" })
      .returning();
    if (!other) throw new Error("missing shop");
    const input = {
      shopId: shop.id,
      sourceType: "booking" as const,
      sourceId: booking.id,
      currency: "usd",
      method: "other",
      balanceCents: 100,
      evidence: {},
    };
    await expect(
      db.transaction((tx) => recordCollectionBalance(tx, { ...input, currency: "wat" })),
    ).rejects.toThrow("collection_ledger_invalid_money");
    await expect(
      db.transaction((tx) => recordCollectionBalance(tx, { ...input, shopId: other.id })),
    ).rejects.toThrow("collection_ledger_source_missing");
    expect(
      await db.select().from(collectionEntries).where(eq(collectionEntries.shopId, shop.id)),
    ).toEqual([]);
  });
});
