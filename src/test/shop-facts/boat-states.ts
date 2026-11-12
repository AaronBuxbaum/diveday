import { and, eq, gte, inArray, isNull, notInArray } from "drizzle-orm";
import { seedRollCallEvidence } from "@/db/seed-roll-call-evidence";
import type { AppDb } from "../../db/client";
import { getBookingReadiness } from "../../db/readiness";
import { seatMarks } from "../../db/roll-call-subject";
import {
  bookings,
  people,
  personRoles,
  rollCallEvents,
  trips,
  waiverRecords,
} from "../../db/schema/index";
import { seedArrivals } from "../../db/seed-arrivals";
import { DEMO_COMPLETED_TRIP_TITLE } from "../../db/seed-more-trips";
import { livePerson, liveTrip } from "../../db/trips-live";
import { checkInBooking } from "../../features/check-in/store";
import { STAFF_ROLES } from "../../lib/authz";
import { HOUR_MS } from "../../lib/clock";

/**
 * The boat facts of the shop's test fixture (`src/test/shop-facts/index.ts`). Each is opt-in for the route's own reason: it moves
 * a departure's counts, and only the spec or capture that asks pays for it.
 *
 * - `checkedInBlocked` (#2410): a diver checked in at the counter, then blocked
 *   (their release taken back, the way an expiry would), on a departure still
 *   inside its arrivals window. The counter must keep them under "Still to
 *   clear" and never paint the all-clear over them.
 * - `uncountedSeat` (#2408): one more seat on the demo's finished dawn boat
 *   that nobody said anything about at the dock, and one more turned away
 *   there, so its record carries all three dock outcomes: Sailed, Didn't sail
 *   and Not counted at the dock. The seed itself sails nobody readiness would
 *   refuse (#2415, UX review 2026-10-13 item 40), so "Didn't sail" is written
 *   here rather than left to the seed's draw.
 */

/**
 * The first seat by the diver's name on the next departure the counter has
 * open that the gate lets check in, through the real writer, and then their
 * release taken back. By name, because seeded names do not move between runs
 * and booking ids do (`boardADiverThenBlockThem` in the route says why).
 */
export async function checkInADiverThenBlockThem(
  db: AppDb,
  shopId: string,
  now: Date,
): Promise<{ tripId: string; personName: string } | null> {
  const candidates = await db
    .select({
      id: bookings.id,
      tripId: bookings.tripId,
      personId: bookings.personId,
      personName: people.fullName,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.status, "booked"),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, now),
        liveTrip(),
        livePerson(),
      ),
    )
    .orderBy(trips.startsAt, people.fullName);
  const [crew] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(eq(people.shopId, shopId), livePerson(), inArray(personRoles.role, [...STAFF_ROLES])),
    )
    .limit(1);
  if (!crew) return null;

  for (const booking of candidates) {
    const checkedIn = await checkInBooking(db, {
      shopId,
      bookingId: booking.id,
      recordedByPersonId: crew.id,
      now,
    });
    // `not_ready` is the gate refusing a blocked diver; a departure outside
    // its arrivals window refuses too. Either way, the next seat.
    if (!checkedIn.ok) continue;
    await db
      .update(waiverRecords)
      .set({ supersededAt: now })
      .where(
        and(
          eq(waiverRecords.shopId, shopId),
          eq(waiverRecords.personId, booking.personId),
          isNull(waiverRecords.supersededAt),
        ),
      );
    // The state only exists if the take-back blocked them; say so rather
    // than hand a spec a diver who still clears.
    const readiness = await getBookingReadiness(db, shopId, booking.id);
    if (readiness?.status === "ready") return null;
    return { tripId: booking.tripId, personName: booking.personName };
  }
  return null;
}

/**
 * A seated customer not already on the finished dawn boat, put on it by a
 * direct insert: the doors refuse a seat on a boat that has sailed, which is
 * right, and this is the record of a seat that was sold before it did. Its
 * roll call is left empty, so the record files it under "Not counted at the
 * dock". Chosen by name for the reason above.
 */
export async function leaveASeatUncounted(
  db: AppDb,
  shopId: string,
): Promise<{ tripId: string; personName: string } | null> {
  const [trip] = await db
    .select({ id: trips.id, startsAt: trips.startsAt })
    .from(trips)
    .where(and(eq(trips.shopId, shopId), eq(trips.title, DEMO_COMPLETED_TRIP_TITLE), liveTrip()))
    .limit(1);
  if (!trip) return null;
  const aboard = db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.tripId, trip.id));
  const candidates = await db
    .selectDistinct({ id: people.id, fullName: people.fullName })
    .from(people)
    .innerJoin(bookings, eq(bookings.personId, people.id))
    .where(and(eq(people.shopId, shopId), livePerson(), notInArray(people.id, aboard)))
    .orderBy(people.fullName)
    .limit(2);
  const [person, turnedAway] = candidates;
  if (!person) return null;
  const seat = (personId: string) => ({
    shopId,
    tripId: trip.id,
    personId,
    bookedAs: "diver" as const,
    status: "booked" as const,
    createdAt: new Date(trip.startsAt.getTime() - 24 * HOUR_MS),
  });
  const [counted] = await db
    .select({ recorderId: rollCallEvents.recordedByPersonId })
    .from(rollCallEvents)
    .where(and(eq(rollCallEvents.shopId, shopId), seatMarks(), eq(rollCallEvents.tripId, trip.id)))
    .limit(1);
  // Through the desk before the boat left: the arrival trail, never a seat
  // status (issue #2702). Only when someone on this boat's record can have
  // said so.
  const seen = async (bookingId: string) => {
    if (!counted) return;
    await seedArrivals(db, [
      {
        shopId,
        tripId: trip.id,
        bookingId,
        recordedByPersonId: counted.recorderId,
        occurredAt: new Date(trip.startsAt.getTime() - HOUR_MS),
      },
    ]);
  };
  const [uncounted] = await db.insert(bookings).values(seat(person.id)).returning();
  if (uncounted) await seen(uncounted.id);
  if (turnedAway && counted) {
    const [refused] = await db.insert(bookings).values(seat(turnedAway.id)).returning();
    if (refused) {
      await seen(refused.id);
      await seedRollCallEvidence(
        db,
        {
          shopId,
          tripId: trip.id,
          bookingId: refused.id,
          recordedByPersonId: counted.recorderId,
          status: "not_boarded",
          checkpoint: "departure",
          source: "live",
          occurredAt: trip.startsAt,
        },
        { observesPrevious: false },
      );
    }
  }
  return { tripId: trip.id, personName: person.fullName };
}
