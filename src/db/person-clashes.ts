import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { alias, unionAll } from "drizzle-orm/pg-core";
import { nowDate } from "@/lib/clock";
import { hasReturned } from "@/lib/trips";
import type { DbExecutor } from "./client";
import { bookings, people, tripAssignments, tripScheduleDays, trips } from "./schema";
import { legWindow, windowsOverlap } from "./trips-clashes";
import { liveTrip } from "./trips-live";
import { seatHeld } from "./trips-queries";

/** How a person is on a departure: rostered as crew, or holding a seat. */
export type PersonPresence = "crew" | "diver";

/**
 * One person on this departure and on another whose hours overlap it, in at
 * least one role that is a seat (issue #4474). Crew on two boats is
 * `crewClashes`' (src/db/trips-crew.ts), refused at the write and reported
 * there; this is the rest: a divemaster booked as a diver on the other boat,
 * or one diver holding seats on two boats at once.
 */
export type PersonClash = {
  personId: string;
  fullName: string;
  here: PersonPresence;
  otherTripId: string;
  otherTitle: string;
  there: PersonPresence;
};

/**
 * Who on each departure is also on another overlapping departure, read from
 * committed rows every time (**information, never a gate**: a diver may hold a
 * morning and an afternoon seat a writer cannot tell apart from a mistake, and
 * the boat-resource ADR keeps overlaps as warnings).
 *
 * Because it is a read rather than a stored flag, nothing can leave it stale:
 * a move, a crew edit and a schedule change committed in any order are all in
 * the next read. A writer that wants to say "this move made a clash" reads it
 * **after its own commit** (`personClashesAfterMove`), so whichever of two
 * racing writers commits second sees the first and says so.
 *
 * Same overlap predicate as every clash reader (`windowsOverlap` over
 * `legWindow`), a called-off departure holds nobody's day, a released or
 * unconfirmed-identity seat holds no seat, and a departure already home has
 * nothing left to fix.
 */
export async function personClashesByTrip(
  db: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
  now: Date = nowDate(),
): Promise<Map<string, PersonClash[]>> {
  const byTrip = new Map<string, PersonClash[]>();
  if (tripIds.length === 0) return byTrip;

  const presence = (name: string) =>
    unionAll(
      db
        .select({
          personId: tripAssignments.personId,
          tripId: tripAssignments.tripId,
          role: sql<PersonPresence>`'crew'`.as("role"),
        })
        .from(tripAssignments),
      db
        .select({
          personId: bookings.personId,
          tripId: bookings.tripId,
          role: sql<PersonPresence>`'diver'`.as("role"),
        })
        .from(bookings)
        .where(and(eq(bookings.shopId, shopId), seatHeld, isNull(bookings.identityUnconfirmedAt))),
    ).as(name);
  const here = presence("presence_here");
  const there = presence("presence_there");
  const subject = alias(trips, "subject_trip");
  const subjectDay = alias(tripScheduleDays, "subject_day");

  const rows = await db
    .select({
      tripId: subject.id,
      subjectEndsAt: subject.endsAt,
      personId: here.personId,
      fullName: people.fullName,
      here: here.role,
      otherTripId: trips.id,
      otherTitle: trips.title,
      otherStartsAt: trips.startsAt,
      there: there.role,
    })
    .from(here)
    .innerJoin(subject, eq(subject.id, here.tripId))
    .leftJoin(subjectDay, eq(subjectDay.tripId, subject.id))
    .innerJoin(there, and(eq(there.personId, here.personId), ne(there.tripId, here.tripId)))
    .innerJoin(trips, eq(trips.id, there.tripId))
    .leftJoin(tripScheduleDays, eq(tripScheduleDays.tripId, trips.id))
    .innerJoin(people, eq(people.id, here.personId))
    .where(
      and(
        inArray(subject.id, [...tripIds]),
        eq(subject.shopId, shopId),
        eq(subject.status, "scheduled"),
        isNull(subject.deletedAt),
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        // Crew on both is `crewClashes`'; every other pairing is this read's.
        or(eq(here.role, "diver"), eq(there.role, "diver")),
        windowsOverlap(legWindow(tripScheduleDays, trips), legWindow(subjectDay, subject)),
      ),
    )
    .orderBy(asc(people.fullName), asc(trips.startsAt), asc(trips.title), asc(trips.id));

  const seen = new Set<string>();
  for (const row of rows) {
    if (hasReturned(row.subjectEndsAt, now)) continue;
    // One line per person, role pair and other departure: the leg joins repeat it.
    const key = `${row.tripId}:${row.personId}:${row.here}:${row.otherTripId}:${row.there}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = byTrip.get(row.tripId) ?? [];
    list.push({
      personId: row.personId,
      fullName: row.fullName,
      here: row.here,
      otherTripId: row.otherTripId,
      otherTitle: row.otherTitle,
      there: row.there,
    });
    byTrip.set(row.tripId, list);
  }
  return byTrip;
}

/**
 * The clashes one person stands in on one departure, read **after** the write
 * that put them there has committed: the warning a move reports. Crew pairs
 * come from `crewClashesByTrip`'s caller; this adds the seat pairs.
 */
export async function personClashesAfterMove(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  personId: string,
  now: Date = nowDate(),
): Promise<PersonClash[]> {
  const clashes = (await personClashesByTrip(db, shopId, [tripId], now)).get(tripId) ?? [];
  return clashes.filter((clash) => clash.personId === personId);
}

/** {@link personClashesAfterMove} for the diver holding one seat, read after the seat move commits. */
export async function seatClashesAfterMove(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  bookingId: string,
  now: Date = nowDate(),
): Promise<PersonClash[]> {
  const [seat] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    .limit(1);
  if (!seat) return [];
  return personClashesAfterMove(db, shopId, tripId, seat.personId, now);
}
