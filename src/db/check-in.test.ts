// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { checkInBooking, listCheckInQueue, listWalkInTrips } from "./check-in";
import { recordRollCall } from "./manifests";
import { listTripsReadiness } from "./readiness";
import { bookings } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

const clearAnswers = { questionnaireId: "rstc", questionnaireVersion: 1, responses: {} };

async function context() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const reef = trips.find((trip) => trip.title === "Two-Tank Reef — Molasses & French");
  if (!reef) throw new Error("seeded reef trip missing");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("seeded staff missing");
  const [booking] = await getTripRoster(db, shop.id, reef.id);
  if (!booking) throw new Error("seeded booking missing");
  return {
    db,
    shop,
    reef,
    staff: staff.person,
    booking: booking.booking,
    personName: booking.person.fullName,
  };
}

describe("counter check-in", () => {
  it("searches the bounded queue and keeps blocked divers out of check-in", async () => {
    const { db, shop } = await context();
    const queue = await listCheckInQueue(db, shop.id);
    expect(queue.length).toBeGreaterThan(0);
    expect(queue.every((row) => ["booked", "checked_in"].includes(row.bookingStatus))).toBe(true);

    const searched = await listCheckInQueue(db, shop.id, { query: "Priya Sharma" });
    expect(searched).toHaveLength(1);
    expect(searched[0]?.readiness.status).toBe("blocked");
  });

  it("offers the same day-of trips for a walk-in as the check-in queue reads", async () => {
    const { db, shop, reef } = await context();
    const options = await listWalkInTrips(db, shop.id);
    expect(options.length).toBeGreaterThan(0);
    expect(options.map((o) => o.tripId)).toContain(reef.id);
    const reefOption = options.find((o) => o.tripId === reef.id);
    expect(reefOption?.capacity).toBe(reef.capacity);
    expect(reefOption?.booked).toBe(reef.booked);
  });

  it("rechecks readiness, records a successful check-in, and is idempotent", async () => {
    const { db, shop, staff, booking, personName } = await context();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    await completeWaiver(db, issued.token, {
      signerName: personName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });

    const outcome = await checkInBooking(db, {
      shopId: shop.id,
      bookingId: booking.id,
      recordedByPersonId: staff.id,
    });
    expect(outcome).toMatchObject({ ok: true, bookingId: booking.id });

    const [saved] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(saved?.status).toBe("checked_in");

    await expect(
      checkInBooking(db, {
        shopId: shop.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
      }),
    ).resolves.toMatchObject({ ok: true, duplicate: true });
  });

  it("shows a diver as boarded once roll call records them, independent of counter check-in (task 149)", async () => {
    // Check-in and boarding are two different questions — arrived vs.
    // aboard. The check-in queue's own description promises this split, but
    // the queue never actually showed boarding before task 149.
    const { db, shop, reef, staff, booking, personName } = await context();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    await completeWaiver(db, issued.token, {
      signerName: personName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });

    const beforeBoarding = await listCheckInQueue(db, shop.id, { query: personName });
    expect(beforeBoarding[0]?.boarded).toBe(false);

    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.id,
        recordedByPersonId: staff.id,
        status: "boarded",
      }),
    ).resolves.toMatchObject({ ok: true });

    const afterBoarding = await listCheckInQueue(db, shop.id, { query: personName });
    // Boarded on the manifest, but never checked in at the counter — the two
    // states stay independent rather than one implying the other.
    expect(afterBoarding[0]?.boarded).toBe(true);
    expect(afterBoarding[0]?.bookingStatus).toBe("booked");
  });

  it("refuses a cross-tenant booking or non-staff actor", async () => {
    const { db, booking } = await context();
    await expect(
      checkInBooking(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        bookingId: booking.id,
        recordedByPersonId: "00000000-0000-4000-8000-000000000000",
      }),
    ).resolves.toEqual({ ok: false, reason: "staff_not_found" });
  });

  it("refuses to check in a booking that is not ready", async () => {
    const { db, shop, staff, booking } = await context();
    const outcome = await checkInBooking(db, {
      shopId: shop.id,
      bookingId: booking.id,
      recordedByPersonId: staff.id,
    });
    expect(outcome).toMatchObject({ ok: false, reason: "not_ready" });
  });

  it("queries readiness for multiple trips at once using listTripsReadiness", async () => {
    const { db, shop, reef } = await context();
    const results = await listTripsReadiness(db, shop.id, [reef.id]);
    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    expect(results.find((r) => r.booking.tripId === reef.id)).toBeDefined();
  });
});
