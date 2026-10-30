import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { getTripManifest, recordCrewRollCall, recordRollCall } from "@/db/manifests";
import { markBookingNoShow } from "@/db/no-show";
import { boats, bookings, certifications, people, personRoles, trips } from "@/db/schema";
import { liveTrip } from "@/db/trips-live";
import { completeWaiver, issueWaiverRequest } from "@/db/waivers";
import { STAFF_ROLES } from "@/lib/authz";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";

export async function manifestOverCapacityState(
  request: Request,
  db: AppDb,
  shopId: string,
  now: Date,
): Promise<{ manifestOverCapacity?: { tripId: string } }> {
  if (new URL(request.url).searchParams.get("manifestOverCapacity") !== "1") return {};
  const manifestOverCapacity = await seedManifestOverCapacityState(db, shopId, now);
  return manifestOverCapacity ? { manifestOverCapacity } : {};
}

/**
 * A manifest whose trip and boat capacity warnings can be read together.
 * The no-show and roll-call trails use their domain writers; only the stored
 * limits are lowered directly because editors refuse values below held seats.
 */
export async function seedManifestOverCapacityState(
  db: AppDb,
  shopId: string,
  now: Date,
): Promise<{ tripId: string } | null> {
  const [staff] = await db
    .select({ id: people.id })
    .from(people) // diveday:allow-deleted-people: an e2e seed finds the people it just seeded
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), inArray(personRoles.role, [...STAFF_ROLES])))
    .limit(1);
  if (!staff) return null;

  const candidates = await db
    .select({ id: trips.id, boatId: trips.boatId, startsAt: trips.startsAt })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        isNotNull(trips.boatId),
        liveTrip(),
        gte(trips.startsAt, now),
      ),
    )
    .orderBy(trips.startsAt);

  for (const candidate of candidates) {
    const manifest = await getTripManifest(db, shopId, candidate.id);
    if (!manifest || manifest.crew.length === 0) continue;
    const roster = await db
      .select({ id: bookings.id, personId: bookings.personId, fullName: people.fullName })
      .from(bookings)
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(
        and(
          eq(bookings.shopId, shopId),
          eq(bookings.tripId, candidate.id),
          inArray(bookings.status, ["booked", "checked_in"]),
        ),
      )
      .orderBy(people.fullName);
    if (roster.length < 2) continue;

    // Keep the example deterministic by releasing the first name-sorted seat.
    const firstSeat = roster[0];
    if (!firstSeat) continue;
    for (const seat of roster) {
      const issued = await issueWaiverRequest(db, { shopId, bookingId: seat.id });
      if (issued.ok) {
        await completeWaiver(db, issued.token, {
          signerName: seat.fullName,
          agreed: true,
          medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
        });
      }
    }
    const released = await markBookingNoShow(db, {
      shopId,
      bookingId: firstSeat.id,
      recordedByPersonId: staff.id,
      now: candidate.startsAt,
    });
    if (!released.ok) continue;

    let boardedPassengers = 0;
    for (const seat of roster) {
      const board = () =>
        recordRollCall(db, {
          shopId,
          tripId: candidate.id,
          bookingId: seat.id,
          recordedByPersonId: staff.id,
          status: "boarded",
          occurredAt: candidate.startsAt,
        });
      let result = await board();
      if (!result.ok && result.reason === "not_ready") {
        // Nadia is intentionally uncarded in the demo. Verify her through the
        // normal certification row before retrying the boarding writer.
        await db.insert(certifications).values({
          shopId,
          personId: seat.personId,
          agency: "padi" as const,
          level: "open_water" as const,
          identifier: "DEMO-MANIFEST-CAPACITY",
          status: "verified" as const,
          reviewedByPersonId: staff.id,
          reviewedAt: now,
        });
        result = await board();
      }
      if (result.ok) boardedPassengers += 1;
    }

    let boardedCrew = 0;
    for (const member of manifest.crew) {
      const result = await recordCrewRollCall(db, {
        shopId,
        tripId: candidate.id,
        personId: member.id,
        recordedByPersonId: staff.id,
        status: "boarded",
        occurredAt: candidate.startsAt,
      });
      if (result.ok) boardedCrew += 1;
    }
    if (boardedPassengers < 2 || boardedCrew === 0 || !candidate.boatId) continue;

    // The test seed places the old/overfull state that the warnings report.
    await db
      .update(trips)
      .set({ capacity: boardedPassengers - 1 })
      .where(and(eq(trips.id, candidate.id), eq(trips.shopId, shopId)));
    await db
      .update(boats)
      .set({ capacity: boardedPassengers + boardedCrew - 1 })
      .where(and(eq(boats.id, candidate.boatId), eq(boats.shopId, shopId)));
    return { tripId: candidate.id };
  }
  return null;
}
