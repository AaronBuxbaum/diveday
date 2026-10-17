import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { recordRollCall } from "./manifests";
import { bookings, rollCallEvents } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { turnBookingAway } from "./turn-away";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/**
 * **The rail's reclaim meets the event's readiness record** (issue #2414): a
 * diver the desk turned away for an unsigned waiver who is counted after a
 * dive is on the boat, so the count stands and the seat comes back, and the
 * event keeps that they were counted aboard while blocked.
 */
describe("an after-dive count of a turned-away diver", () => {
  it("reclaims the seat and keeps the blocker on the event", async () => {
    const { db, shop } = ctx;
    const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
      (candidate) => candidate.title === "Two-Tank Reef — Molasses & French",
    );
    if (!trip) throw new Error("seeded reef trip missing");
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seeded staff missing");
    const [seat] = await getTripRoster(db, shop.id, trip.id);
    if (!seat) throw new Error("seeded booking missing");
    const bookingId = seat.booking.id;
    const staffId = staff.person.id;
    await turnBookingAway(db, {
      shopId: shop.id,
      bookingId,
      reason: "waiver",
      recordedByPersonId: staffId,
      now: new Date(trip.startsAt.getTime() - HOUR_MS),
    });

    expect(
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId,
        recordedByPersonId: staffId,
        status: "boarded",
        checkpoint: "after_dive_1",
      }),
    ).toMatchObject({ ok: true });

    const [row] = await db
      .select({ status: bookings.status, reason: bookings.turnedAwayReason })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    expect(row).toEqual({ status: "booked", reason: null });
    const [event] = await db
      .select({ status: rollCallEvents.readinessStatus })
      .from(rollCallEvents)
      .where(
        and(eq(rollCallEvents.bookingId, bookingId), eq(rollCallEvents.checkpoint, "after_dive_1")),
      );
    expect(event?.status).toBe("blocked");
  });
});
