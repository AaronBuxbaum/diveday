import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { cancelBooking, createBooking } from "./bookings";
import { setBookingPayment } from "./payments";
import { getReadyPageData } from "./ready";
import { bookings } from "./schema";
import { getTripRoster, setTripStatus, upcomingTripsWithCounts } from "./trips";

async function seededBooking() {
  const { db, shop } = await seededShopContext();
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("demo trip missing");
  const [entry] = await getTripRoster(db, shop.id, trip.id);
  if (!entry) throw new Error("demo booking missing");
  return { db, shop, trip, booking: entry.booking, person: entry.person };
}

const visitor = { fullName: "Nora Quinn", email: "nora@example.com", phone: "+1-305-555-0199" };

/** A fresh unpaid booking on the seeded "open" reef trip (docs ADR 20260727-diver-self-service-cancel). */
async function unpaidBooking() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const open = trips.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  const fullTrip = trips.find((t) => t.title === "Wreck Trip — Spiegel Grove");
  const night = trips.find((t) => t.title.startsWith("Night Dive"));
  if (!open || !fullTrip || !night) throw new Error("expected seeded trips missing");
  const booked = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: open.id,
    ...visitor,
  });
  if (!booked.ok) throw new Error("setup booking failed");
  return { db, shop, open, fullTrip, night, bookingId: booked.bookingId };
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
});

describe("getReadyPageData reschedule candidates (diver self-service, docs ADR 20260727-diver-self-service-cancel)", () => {
  it("offers another open trip but excludes the current trip and a full one", async () => {
    const { db, open, fullTrip, night, bookingId } = await unpaidBooking();
    const data = await getReadyPageData(db, bookingId);
    const ids = data?.rescheduleCandidates?.map((c) => c.id) ?? [];
    expect(ids).toContain(night.id);
    expect(ids).not.toContain(open.id);
    expect(ids).not.toContain(fullTrip.id);
  });

  it("hides the reschedule picker entirely once a booking has captured payment", async () => {
    const { db, shop, bookingId } = await unpaidBooking();
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId,
      status: "paid",
      currency: "usd",
      amountCents: 15_000,
      provider: "stripe",
      providerRef: "cs_test_1",
    });
    const data = await getReadyPageData(db, bookingId);
    expect(data?.rescheduleCandidates).toBeNull();
    // …and says why, so the page can explain the absence instead of just
    // dropping the picker (cancel is still the diver's to make).
    expect(data?.rescheduleBlocked).toBe("payment_settled");
    expect(data?.manageState).toBe("self_serve");
  });

  it("previews an unpaid cancel as owing no refund", async () => {
    const { db, bookingId } = await unpaidBooking();
    const data = await getReadyPageData(db, bookingId);
    expect(data?.cancelPreview).toBe("unpaid");
  });

  it("hides the whole change-plans section once the booking is checked in (Codex finding)", async () => {
    // Both self-service mutations only ever succeed on a plain `booked` seat
    // — a day-of checked_in flip means cancel/reschedule would only ever
    // fail server-side, so the controls themselves shouldn't be shown.
    const { db, bookingId } = await unpaidBooking();
    await db.update(bookings).set({ status: "checked_in" }).where(eq(bookings.id, bookingId));
    const data = await getReadyPageData(db, bookingId);
    expect(data?.canManageBooking).toBe(false);
    expect(data?.rescheduleCandidates).toBeNull();
  });

  it("hides the whole change-plans section once the booking is a no-show (Codex finding)", async () => {
    const { db, bookingId } = await unpaidBooking();
    await db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, bookingId));
    const data = await getReadyPageData(db, bookingId);
    expect(data?.canManageBooking).toBe(false);
    expect(data?.rescheduleCandidates).toBeNull();
  });

  it("hides the whole change-plans section once the trip has departed (Codex finding)", async () => {
    const { db, open, bookingId } = await unpaidBooking();
    const afterDeparture = new Date(open.startsAt.getTime() + 60 * 60 * 1000);
    const data = await getReadyPageData(db, bookingId, afterDeparture);
    expect(data?.canManageBooking).toBe(false);
    expect(data?.rescheduleCandidates).toBeNull();
  });

  it("still offers the change-plans section for a plain booked seat on a future trip", async () => {
    const { db, bookingId } = await unpaidBooking();
    const data = await getReadyPageData(db, bookingId);
    expect(data?.canManageBooking).toBe(true);
    expect(data?.manageState).toBe("self_serve");
    expect(data?.rescheduleBlocked).toBeNull();
  });

  it("keeps a shop-only route open on trip morning instead of showing nothing", async () => {
    // Checked in on the day: cancel/reschedule can't work, but the shop can
    // still act — and this is the moment a diver most needs their number.
    const { db, bookingId } = await unpaidBooking();
    await db.update(bookings).set({ status: "checked_in" }).where(eq(bookings.id, bookingId));
    const data = await getReadyPageData(db, bookingId);
    expect(data?.manageState).toBe("shop_only");
    expect(data?.rescheduleBlocked).toBe("booking_closed");
  });

  it("closes the section only once the trip is genuinely over", async () => {
    const { db, open, bookingId } = await unpaidBooking();
    const midTrip = new Date(open.startsAt.getTime() + 60 * 60 * 1000);
    const afterTrip = new Date(open.endsAt.getTime() + 60 * 60 * 1000);
    expect((await getReadyPageData(db, bookingId, midTrip))?.manageState).toBe("shop_only");
    expect((await getReadyPageData(db, bookingId, afterTrip))?.manageState).toBe("closed");
  });

  it("names an empty calendar as the reason there is nowhere to move to", async () => {
    // Cancel every other upcoming departure: nothing is settled and the seat
    // is live, so the only reason the picker is empty is the calendar itself.
    const { db, shop, open, bookingId } = await unpaidBooking();
    const upcoming = await upcomingTripsWithCounts(db, shop.id);
    for (const candidate of upcoming) {
      if (candidate.id !== open.id) await setTripStatus(db, shop.id, candidate.id, "cancelled");
    }
    const data = await getReadyPageData(db, bookingId);
    expect(data?.rescheduleCandidates).toEqual([]);
    expect(data?.rescheduleBlocked).toBe("no_open_trips");
    expect(data?.manageState).toBe("self_serve");
  });

  it("hides the reschedule picker for a waived booking too (Codex finding)", async () => {
    // rescheduleBooking refuses a waived booking the same as paid/deposit-paid
    // (staff excused the fee) — the picker must not promise a move it can't
    // deliver.
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
    expect(data?.rescheduleCandidates).toBeNull();
  });
});
