import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import { recordCheckoutCollection } from "./collection-ledger";
import { getBookingPayment, setBookingPayment } from "./payments";
import { recordStripeChargeRefund } from "./refunds";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookings,
  people,
  shops,
  trips,
} from "./schema";

async function fixture() {
  const db = await unseededTestDb();
  const [shop] = await db
    .insert(shops)
    .values({ name: "Dash Shop", slug: "dash-shop", timezone: "UTC" })
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
      priceCents: 10_000,
    })
    .returning();
  if (!trip) throw new Error("trip missing");
  const [booking] = await db
    .insert(bookings)
    .values({ shopId: shop.id, tripId: trip.id, personId: person.id, bookedAs: "diver" })
    .returning();
  if (!booking) throw new Error("booking missing");
  const [checkout] = await db
    .insert(bookingCheckouts)
    .values({
      shopId: shop.id,
      tripId: trip.id,
      currency: "usd",
      amountPerDiverCents: 10_000,
      totalCents: 10_000,
      settledTotalCents: 10_000,
      taxCents: 0,
      status: "completed",
      stripeAccountId: "acct_dash",
      stripeSessionId: "cs_dash",
      stripePaymentIntentId: "pi_dash",
      completedAt: new Date("2026-07-21T13:30:00Z"),
    })
    .returning();
  if (!checkout) throw new Error("checkout missing");
  await db
    .insert(bookingCheckoutBookings)
    .values({ shopId: shop.id, checkoutId: checkout.id, bookingId: booking.id, tripCents: 10_000 });
  await db.transaction((tx) => recordCheckoutCollection(tx, shop.id, checkout.id));
  await setBookingPayment(db, {
    shopId: shop.id,
    bookingId: booking.id,
    status: "paid",
    amountCents: 10_000,
    currency: "usd",
    provider: "stripe",
    providerRef: checkout.stripeSessionId,
  });
  const refund = (amountRefundedCents: number, at: string) =>
    recordStripeChargeRefund(db, {
      stripeAccountId: "acct_dash",
      paymentIntentId: "pi_dash",
      chargeId: "ch_dash",
      amountRefundedCents,
      occurredAt: new Date(at),
    });
  const refundedCents = async () => {
    const [row] = await db
      .select({ refundedCents: bookingCheckouts.refundedCents })
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.id, checkout.id));
    return row?.refundedCents;
  };
  return { db, shop, booking, refund, refundedCents };
}

describe("a dashboard refund of a single-seat checkout", () => {
  it("keeps the seat boardable after a partial refund and counts a bigger total once", async () => {
    const f = await fixture();
    expect(await f.refund(4_000, "2026-07-21T14:00:00Z")).toMatchObject({
      status: "checkout_refunded",
    });
    expect(await getBookingPayment(f.db, f.shop.id, f.booking.id)).toMatchObject({
      status: "partly_refunded",
      amountCents: 6_000,
    });
    // Stripe's cumulative figure: the second refund is 3_000 more, not 7_000.
    expect(await f.refund(7_000, "2026-07-21T15:00:00Z")).toMatchObject({
      status: "checkout_refunded",
    });
    expect(await f.refundedCents()).toBe(7_000);
    expect(await getBookingPayment(f.db, f.shop.id, f.booking.id)).toMatchObject({
      status: "partly_refunded",
      amountCents: 3_000,
    });
  });

  it("counts nothing for a replay or an older event that arrives late", async () => {
    const f = await fixture();
    await f.refund(7_000, "2026-07-21T15:00:00Z");
    expect(await f.refund(7_000, "2026-07-21T15:00:00Z")).toEqual({ status: "already_recorded" });
    expect(await f.refund(4_000, "2026-07-21T14:00:00Z")).toEqual({ status: "already_recorded" });
    expect(await f.refundedCents()).toBe(7_000);
    expect(await getBookingPayment(f.db, f.shop.id, f.booking.id)).toMatchObject({
      status: "partly_refunded",
      amountCents: 3_000,
    });
  });

  it("never counts more than was captured, and a full refund marks the seat refunded", async () => {
    const f = await fixture();
    expect(await f.refund(12_000, "2026-07-21T14:00:00Z")).toMatchObject({
      status: "checkout_refunded",
    });
    expect(await f.refundedCents()).toBe(10_000);
    expect(await getBookingPayment(f.db, f.shop.id, f.booking.id)).toMatchObject({
      status: "refunded",
    });
    // A refund after a full one, even a nonsensical one, moves nothing.
    expect(await f.refund(12_000, "2026-07-21T16:00:00Z")).toEqual({ status: "already_recorded" });
  });

  it("answers not_found for a charge DiveDay never raised", async () => {
    const f = await fixture();
    expect(
      await recordStripeChargeRefund(f.db, {
        stripeAccountId: "acct_dash",
        paymentIntentId: "pi_unknown",
        chargeId: "ch_x",
        amountRefundedCents: 100,
        occurredAt: new Date("2026-07-21T14:00:00Z"),
      }),
    ).toEqual({ status: "not_found" });
    // Another shop's account never reaches this checkout.
    expect(
      await recordStripeChargeRefund(f.db, {
        stripeAccountId: "acct_other",
        paymentIntentId: "pi_dash",
        chargeId: "ch_x",
        amountRefundedCents: 100,
        occurredAt: new Date("2026-07-21T14:00:00Z"),
      }),
    ).toEqual({ status: "not_found" });
    expect(await f.refundedCents()).toBe(0);
  });
});
