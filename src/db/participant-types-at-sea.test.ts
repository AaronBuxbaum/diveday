// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import type { ParticipantType } from "@/lib/participant-types";
import { fileScopedShopContext } from "@/test/db";
import { createBooking, setBookingParticipantType } from "./bookings";
import type { AppDb } from "./client";
import { recordRollCall } from "./manifests";
import { listTripReadiness } from "./readiness";
import {
  activityEvents,
  bookings,
  certifications,
  tripDeskEvents,
  tripRequirements,
  trips,
  waiverRecords,
} from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { issueWaiverRequest } from "./waivers";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/**
 * **Who is aboard, and what each of them is doing** (ADR
 * 20261007-participant-types).
 *
 * Every test here starts from the Benwood reef trip: three divers booked, no
 * buddy teams, no course. Each one sets the two limits it is about by hand, so
 * the arithmetic it checks is on the page rather than in the seed.
 *
 * The subject is the booking transaction and its trip-row lock, run inside the
 * file's rolled-back transaction as a savepoint. PGlite is one connection, so
 * the lock is uncontended either way; contention is a `*.postgres.test.ts`
 * question.
 */
async function benwood() {
  const { db, shop } = ctx;
  const tripRows = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const trip = tripRows.find((row) => row.title.startsWith("Two-Tank Reef — Benwood"));
  if (!trip) throw new Error("demo Benwood trip missing");
  const roster = await getTripRoster(db, shop.id, trip.id);
  if (roster.length !== 3) throw new Error("expected three Benwood bookings");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("demo staff missing");
  return { db, shop, trip, roster, staff: staff.person };
}

async function limits(db: AppDb, tripId: string, capacity: number, diverCapacity: number | null) {
  await db.update(trips).set({ capacity, diverCapacity }).where(eq(trips.id, tripId));
}

let seq = 0;
async function seat(
  db: AppDb,
  shopId: string,
  tripId: string,
  participantType: ParticipantType,
  actor: "staff" | "public" = "staff",
) {
  seq += 1;
  return createBooking(db, {
    actor,
    shopId,
    tripId,
    participantType,
    fullName: `Guest ${seq}`,
    email: `guest-${seq}-${participantType}@example.com`,
  });
}

/** The roster's "Coming as", from a staffer, on the departure in the URL. */
async function change(
  db: AppDb,
  ids: { shopId: string; tripId: string; actorPersonId: string },
  bookingId: string,
  to: ParticipantType,
  confirmCertBlock = false,
) {
  return setBookingParticipantType(db, { ...ids, bookingId, to, confirmCertBlock });
}

/**
 * A release signed on this seat that a medical answer parked: a referral no
 * physician has answered, or one a physician refused. Signed now, so the
 * signature itself is current.
 */
async function heldRelease(
  db: AppDb,
  shopId: string,
  bookingId: string,
  hold: "referral" | "refusal",
  staffId?: string,
) {
  await issueWaiverRequest(db, { shopId, bookingId });
  const at = nowDate();
  await db
    .update(waiverRecords)
    .set({
      status: "medical_review",
      medicalReviewRequired: true,
      signedName: "Guest",
      signedAt: at,
      completedAt: at,
      consentedAt: at,
      ...(hold === "refusal"
        ? {
            medicalClearanceDeclinedAt: at,
            medicalClearanceDeclinedByPersonId: staffId,
            medicalClearanceEvaluatedOn: "2026-01-01",
            medicalClearancePhysicianName: "Dr. Reyes",
          }
        : {}),
    })
    .where(eq(waiverRecords.bookingId, bookingId));
}

/** This trip now asks for Advanced Open Water, and nothing else of its own. */
async function demandAdvanced(db: AppDb, shopId: string, tripId: string) {
  await db
    .update(tripRequirements)
    .set({
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: [],
      requiresNitrox: false,
    })
    .where(and(eq(tripRequirements.tripId, tripId), eq(tripRequirements.shopId, shopId)));
}

/** A verified Open Water card on file: known to the shop, and short of Advanced. */
async function openWaterCard(db: AppDb, shopId: string, bookingId: string) {
  const [row] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  if (!row) throw new Error("booking missing");
  await db.insert(certifications).values({
    shopId,
    personId: row.personId,
    agency: "padi",
    level: "open_water",
    identifier: `OW-${bookingId.slice(0, 8)}`,
    status: "verified",
  });
}

/** Waiver and payment off, so a seat's readiness is its card alone. */
async function cardOnlyGate(db: AppDb, shopId: string, tripId: string) {
  await db
    .update(tripRequirements)
    .set({ requiresWaiver: false, requiresPayment: false })
    .where(and(eq(tripRequirements.tripId, tripId), eq(tripRequirements.shopId, shopId)));
}

/** A verified card at `level` for the person on this seat. */
async function cardAt(db: AppDb, shopId: string, bookingId: string, level: "advanced_open_water") {
  const [row] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  if (!row) throw new Error("booking missing");
  await db.insert(certifications).values({
    shopId,
    personId: row.personId,
    agency: "padi",
    level,
    identifier: `AOW-${bookingId.slice(0, 8)}`,
    status: "verified",
  });
}

/**
 * **Joining the dive at sea** (issue #2225, Aaron 2026-10-13): the partner
 * who rode dive 1 dives the second tank. The time on the board no longer
 * refuses it; the same card check does, and only "Change anyway" writes past
 * it, and the trail says the change was made after departure.
 */
describe("joining the dive after departure", () => {
  async function atSea() {
    const context = await benwood();
    const { db, shop, trip } = context;
    await limits(db, trip.id, 8, null);
    await demandAdvanced(db, shop.id, trip.id);
    const rider = await seat(db, shop.id, trip.id, "rider");
    if (!rider.ok) throw new Error("rider not seated");
    const now = nowDate().getTime();
    await db
      .update(trips)
      .set({ startsAt: new Date(now - 30 * 60_000), endsAt: new Date(now + 3 * 3_600_000) })
      .where(eq(trips.id, trip.id));
    const ids = { shopId: shop.id, tripId: trip.id, actorPersonId: context.staff.id };
    return { ...context, ids, bookingId: rider.bookingId };
  }

  async function trail(db: AppDb, tripId: string) {
    return db
      .select()
      .from(activityEvents)
      .where(
        and(eq(activityEvents.tripId, tripId), eq(activityEvents.code, "participant_type_changed")),
      );
  }

  it("lets a rider with the card the trip asks for dive, thirty minutes after departure", async () => {
    const { db, shop, trip, staff, ids, bookingId } = await atSea();
    await cardOnlyGate(db, shop.id, trip.id);
    await cardAt(db, shop.id, bookingId, "advanced_open_water");

    expect(await change(db, ids, bookingId, "diver")).toMatchObject({ ok: true, changed: true });
    const [entry] = await trail(db, trip.id);
    expect(entry?.actorPersonId).toBe(staff.id);
    expect(entry?.params).toMatchObject({
      from: "rider",
      type: "diver",
      certCheck: "none",
      atSea: "yes",
    });
    const desk = await db
      .select()
      .from(tripDeskEvents)
      .where(and(eq(tripDeskEvents.tripId, trip.id), eq(tripDeskEvents.kind, "now_diving")));
    expect(desk.map((row) => [row.bookingId, row.actorPersonId])).toEqual([[bookingId, staff.id]]);
  });

  it("refuses a rider short of the card, and writes nothing", async () => {
    const { db, shop, trip, ids, bookingId } = await atSea();
    await openWaterCard(db, shop.id, bookingId);

    // At sea the card gap is the boarding gate's answer: no "Change anyway".
    expect(await change(db, ids, bookingId, "diver")).toEqual({
      ok: false,
      reason: "boarded_not_ready",
    });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(row?.participantType).toBe("rider");
    expect(await trail(db, trip.id)).toHaveLength(0);
  });

  it("never writes past the card check at sea, even on Change anyway (dock review H1)", async () => {
    // Out on the water there is no rail left to stop them: the person is
    // already aboard, so joining the dive asks the boarding gate itself.
    const { db, shop, trip, ids, bookingId } = await atSea();
    await cardOnlyGate(db, shop.id, trip.id);
    await openWaterCard(db, shop.id, bookingId);

    expect(await change(db, ids, bookingId, "diver", true)).toEqual({
      ok: false,
      reason: "boarded_not_ready",
    });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(row?.participantType).toBe("rider");
    expect(await trail(db, trip.id)).toHaveLength(0);
  });

  it("refuses a rider on a medical hold at sea, though the card is fine and nobody marked them boarded", async () => {
    const { db, shop, trip, ids, bookingId } = await atSea();
    await cardAt(db, shop.id, bookingId, "advanced_open_water");
    await heldRelease(db, shop.id, bookingId, "referral");

    expect(await change(db, ids, bookingId, "diver")).toEqual({
      ok: false,
      reason: "boarded_not_ready",
    });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(row?.participantType).toBe("rider");
    expect(await trail(db, trip.id)).toHaveLength(0);
  });

  it("still writes past the card check on Change anyway before the time on the board", async () => {
    const { db, shop, trip, staff, ids, bookingId } = await atSea();
    const now = nowDate().getTime();
    await db
      .update(trips)
      .set({ startsAt: new Date(now + 3_600_000) })
      .where(eq(trips.id, trip.id));
    await openWaterCard(db, shop.id, bookingId);

    expect(await change(db, ids, bookingId, "diver", true)).toMatchObject({ ok: true });
    const [entry] = await trail(db, trip.id);
    expect(entry?.actorPersonId).toBe(staff.id);
    expect(entry?.params).toMatchObject({ certCheck: "overridden", atSea: "no" });
    // Only the sale-time check was skipped: the boarding gate still asks.
    const rows = await listTripReadiness(db, shop.id, trip.id);
    expect(rows.find((r) => r.booking.id === bookingId)?.readiness.status).toBe("blocked");
  });

  it("refuses a rider boarded at the dock without the card, even on Change anyway", async () => {
    // Adversarial: at sea is where a boarding record matters most. It was
    // granted to a rider and is never carried into the water.
    const { db, shop, trip, staff, ids, bookingId } = await atSea();
    await cardOnlyGate(db, shop.id, trip.id);
    // Boarded before the time on the board, then the clock ran on.
    const now = nowDate().getTime();
    await db
      .update(trips)
      .set({ startsAt: new Date(now + 30 * 60_000) })
      .where(eq(trips.id, trip.id));
    expect(
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId,
        recordedByPersonId: staff.id,
        status: "boarded",
      }),
    ).toMatchObject({ ok: true });
    await db
      .update(trips)
      .set({ startsAt: new Date(now - 30 * 60_000) })
      .where(eq(trips.id, trip.id));
    await openWaterCard(db, shop.id, bookingId);

    expect(await change(db, ids, bookingId, "diver", true)).toEqual({
      ok: false,
      reason: "boarded_not_ready",
    });
    expect(await trail(db, trip.id)).toHaveLength(0);
  });

  it("says nothing about the sea for a change made before the time on the board", async () => {
    const { db, shop, trip, ids, bookingId } = await atSea();
    const now = nowDate().getTime();
    await db
      .update(trips)
      .set({ startsAt: new Date(now + 3_600_000) })
      .where(eq(trips.id, trip.id));
    await cardAt(db, shop.id, bookingId, "advanced_open_water");
    expect(await change(db, ids, bookingId, "diver")).toMatchObject({ ok: true });
    const [entry] = await trail(db, trip.id);
    expect(entry?.params).toMatchObject({ atSea: "no" });
  });
});
