import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { cancelBooking, createBooking, setBookingLastDived } from "./bookings";
import { setBookingPayment } from "./payments";
import { getReadyPageData } from "./ready";
import { bookings } from "./schema";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";

async function seededBooking() {
  const { db, shop } = await seededShopContext();
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("demo trip missing");
  const [entry] = await getTripRoster(db, shop.id, trip.id);
  if (!entry) throw new Error("demo booking missing");
  return { db, shop, trip, booking: entry.booking, person: entry.person };
}

/** A fresh unpaid booking on the seeded "open" reef trip. */
async function unpaidBooking() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const open = trips.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  if (!open) throw new Error("expected seeded open trip missing");
  const booked = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: open.id,
    fullName: "Nora Quinn",
    email: "nora@example.com",
    phone: "+1-305-555-0199",
  });
  if (!booked.ok) throw new Error("setup booking failed");
  return { db, shop, open, bookingId: booked.bookingId };
}

describe("getReadyPageData", () => {
  it("gathers a live booking's readiness, and gates pay off without a Stripe account", async () => {
    const { db, trip, booking } = await seededBooking();
    const data = await getReadyPageData(db, booking.id);
    expect(data).not.toBeNull();
    expect(data?.detail.trip.title).toBe(trip.title);
    expect(data?.detail.cancelled).toBe(false);
    // No connected Stripe account in the seed, so pay-from-page stays off.
    expect(data?.canPay).toBe(false);
  });

  it("marks a cancelled booking so the page (and its write actions) refuse it", async () => {
    const { db, shop, booking } = await seededBooking();
    await cancelBooking(db, shop.id, booking.id);
    const data = await getReadyPageData(db, booking.id);
    // The loader still resolves so the page can say "cancelled" plainly; the
    // transactional actions read this same flag and refuse to write.
    expect(data?.detail.cancelled).toBe(true);
  });

  it("returns null for a booking that does not exist", async () => {
    const { db } = await seededBooking();
    await expect(getReadyPageData(db, "00000000-0000-4000-8000-000000000099")).resolves.toBeNull();
  });

  // The diver-facing cancel came back on 2026-08-21 (ADR
  // 20260821-the-diver-may-release-their-own-seat). These pin the two facts the
  // page renders it from — and `canCancelBooking` has to agree with
  // `selfCancelBooking`'s own pre-checks exactly, or the page offers a button
  // that can only come back refused.
  it("offers the cancel for a plain booked seat on a future departure", async () => {
    const { db, bookingId } = await unpaidBooking();
    const data = await getReadyPageData(db, bookingId);
    expect(data?.canCancelBooking).toBe(true);
    expect(data?.cancelPreview).toBe("unpaid");
  });

  it("withdraws the cancel once the seat is checked in", async () => {
    const { db, bookingId } = await unpaidBooking();
    await db.update(bookings).set({ status: "checked_in" }).where(eq(bookings.id, bookingId));
    expect((await getReadyPageData(db, bookingId))?.canCancelBooking).toBe(false);
  });

  it("withdraws the cancel once the seat is a no-show", async () => {
    const { db, bookingId } = await unpaidBooking();
    await db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, bookingId));
    expect((await getReadyPageData(db, bookingId))?.canCancelBooking).toBe(false);
  });

  it("holds the cancel open for the late-departure hour, and closes it after", async () => {
    // Trips run late, so "has this boat sailed?" allows an hour everywhere
    // (AGENTS.md), and `selfCancelBooking` allows exactly the same hour. A page
    // gate that closed on the scheduled minute would hide a control the domain
    // would still have honoured.
    const { db, open, bookingId } = await unpaidBooking();
    const midBuffer = new Date(open.startsAt.getTime() + 30 * 60 * 1000);
    const pastBuffer = new Date(open.startsAt.getTime() + 60 * 60 * 1000);
    expect((await getReadyPageData(db, bookingId, midBuffer))?.canCancelBooking).toBe(true);
    expect((await getReadyPageData(db, bookingId, pastBuffer))?.canCancelBooking).toBe(false);
  });

  it("reads a waived booking as owing no refund, since there is no money to give back", async () => {
    const { db, shop, bookingId } = await unpaidBooking();
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId,
      status: "waived",
      currency: "usd",
      amountCents: 0,
      provider: null,
      note: "Comp'd",
    });
    const data = await getReadyPageData(db, bookingId);
    expect(data?.cancelPreview).toBe("unpaid");
    expect(data?.canCancelBooking).toBe(true);
  });

  // How recently the diver says they last dived (ADR
  // 20260821-currency-is-what-catches-people). It gates nothing, so the only
  // properties worth pinning are that it round-trips and that absence is a real
  // state rather than a default.
  it("reads back the diver's own currency answer, and nothing before they give one", async () => {
    const { db, shop, bookingId } = await unpaidBooking();
    expect((await getReadyPageData(db, bookingId))?.lastDivedBand).toBeNull();

    expect(
      await setBookingLastDived(db, { shopId: shop.id, bookingId, band: "over_five_years" }),
    ).toBe(true);
    const data = await getReadyPageData(db, bookingId);
    expect(data?.lastDivedBand).toBe("over_five_years");
    // And it moves nothing else: currency is not a gate.
    expect(data?.detail.readiness.status).toBe(
      (await getReadyPageData(db, bookingId))?.detail.readiness.status,
    );
  });

  it("refuses to record currency against a cancelled seat", async () => {
    const { db, shop, bookingId } = await unpaidBooking();
    await cancelBooking(db, shop.id, bookingId);
    expect(await setBookingLastDived(db, { shopId: shop.id, bookingId, band: "this_season" })).toBe(
      false,
    );
  });

  it("refuses to record currency for another shop's booking", async () => {
    const { db, bookingId } = await unpaidBooking();
    expect(
      await setBookingLastDived(db, {
        shopId: "00000000-0000-4000-8000-000000000099",
        bookingId,
        band: "this_season",
      }),
    ).toBe(false);
    expect((await getReadyPageData(db, bookingId))?.lastDivedBand).toBeNull();
  });
});
