import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { getBookingPayment, setBookingPayment } from "./payments";
import { queueBookingRefundOnShopCancellation } from "./refunds";
import { upcomingTripsWithCounts } from "./trips";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/**
 * The queued arm (H-20261013-call-off-queues-refunds): a caller who may not move money still tells the diver
 * the truth about their seat, and moves nothing.
 */
async function seatContext() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const trip = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!trip) throw new Error("demo trip missing");
  const booked = await createBookingParty(db, [
    {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Pat Party",
      email: "pat@example.com",
    },
  ]);
  if (!booked.ok) throw new Error(`booking failed: ${booked.reason}`);
  const bookingId = booked.bookings[0]?.bookingId;
  if (!bookingId) throw new Error("booking missing");
  return { db, shop, bookingId };
}

describe("queueBookingRefundOnShopCancellation", () => {
  it("queues a captured Stripe seat and leaves the money where it is", async () => {
    const { db, shop, bookingId } = await seatContext();
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId,
      status: "paid",
      currency: "usd",
      amountCents: 18_000,
      provider: "stripe",
      providerRef: "pi_queued",
    });
    expect(await queueBookingRefundOnShopCancellation(db, { shopId: shop.id, bookingId })).toEqual({
      status: "queued",
    });
    expect((await getBookingPayment(db, shop.id, bookingId))?.status).toBe("paid");
  });

  it("answers already_refunded for a seat that was refunded", async () => {
    const { db, shop, bookingId } = await seatContext();
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId,
      status: "refunded",
      currency: "usd",
      amountCents: 18_000,
      provider: "stripe",
    });
    expect(await queueBookingRefundOnShopCancellation(db, { shopId: shop.id, bookingId })).toEqual({
      status: "already_refunded",
    });
  });

  it("returns the dive for a seat paid with a package", async () => {
    const { db, shop, bookingId } = await seatContext();
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId,
      status: "paid",
      currency: "usd",
      amountCents: 0,
      provider: "dive_package",
      operation: "package_consumed",
    });
    expect(await queueBookingRefundOnShopCancellation(db, { shopId: shop.id, bookingId })).toEqual({
      status: "dive_returned",
    });
  });

  it("returns the dive when a package was spent but the seat no longer reads captured", async () => {
    const { db, shop, bookingId } = await seatContext();
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId,
      status: "paid",
      currency: "usd",
      amountCents: 0,
      provider: "dive_package",
      operation: "package_consumed",
    });
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId,
      status: "unpaid",
      currency: "usd",
      amountCents: 0,
    });
    expect(await queueBookingRefundOnShopCancellation(db, { shopId: shop.id, bookingId })).toEqual({
      status: "dive_returned",
    });
  });

  it("answers unpaid for a seat nobody paid for", async () => {
    const { db, shop, bookingId } = await seatContext();
    expect(await queueBookingRefundOnShopCancellation(db, { shopId: shop.id, bookingId })).toEqual({
      status: "unpaid",
    });
  });
});
