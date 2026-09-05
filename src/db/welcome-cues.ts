import { and, eq, inArray, isNotNull, lt, max, ne, notInArray } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { DEPARTURE_BUFFER_MS } from "@/lib/closeout";
import type { AppDb, DbExecutor } from "./client";
import { bookings, people, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * The welcome cue's facts (issue #1182, delight report D22).
 *
 * Two values per seat and nothing else: whether the diver said the crew may
 * know, and when they were last on one of this shop's boats. What those add up
 * to is `welcomeCueFor` in `src/lib/welcome-cue.ts` — this module returns rows,
 * never a cue and never a sentence.
 */

export type WelcomeCueInputs = {
  sharedAt: Date | null;
  lastDivedAt: Date | null;
};

/**
 * One query for the whole departure: each live seat's consent stamp, and the
 * start of that diver's most recent already-departed booking with this shop.
 *
 * The "already departed" half is the same predicate `returningDiverIds`
 * (src/db/reminders.ts) uses — a non-cancelled booking on a trip that has
 * started — so "first time with us" means one thing wherever the app says it.
 * It deliberately looks at **every** prior seat, including one on a departure
 * that was later cancelled after sailing: the question is whether this shop has
 * met them, not whether a row is tidy.
 */
export async function welcomeCueInputsByBooking(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  now: Date = nowDate(),
): Promise<Map<string, WelcomeCueInputs>> {
  const prior = db
    .select({
      personId: bookings.personId,
      lastDivedAt: max(trips.startsAt).as("last_dived_at"),
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        ne(bookings.tripId, tripId),
        ne(bookings.status, "cancelled"),
        lt(trips.startsAt, now),
      ),
    )
    .groupBy(bookings.personId)
    .as("prior");

  const rows = await db
    .select({
      bookingId: bookings.id,
      sharedAt: bookings.welcomeSharedAt,
      lastDivedAt: prior.lastDivedAt,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .leftJoin(prior, eq(prior.personId, bookings.personId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        ne(bookings.status, "cancelled"),
        eq(trips.shopId, shopId),
        liveTrip(),
      ),
    );

  return new Map(
    rows.map((row) => [
      row.bookingId,
      { sharedAt: row.sharedAt, lastDivedAt: row.lastDivedAt ?? null },
    ]),
  );
}

export type SharedWelcomeSeat = {
  tripId: string;
  bookingId: string;
  personName: string;
  sharedAt: Date;
  lastDivedAt: Date | null;
};

/**
 * Every **consented** seat across a set of departures, with the name to greet
 * and the gap to greet them about — the shop home's Say hello row (issue #1182).
 *
 * Filtered to consented seats in SQL rather than read whole and filtered after:
 * a departure with nobody who said yes contributes no rows at all, which on
 * most mornings is every departure, and the home's queue is assembled on every
 * page load.
 */
export async function sharedWelcomeSeatsByTrip(
  db: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
  now: Date = nowDate(),
): Promise<Map<string, SharedWelcomeSeat[]>> {
  const byTrip = new Map<string, SharedWelcomeSeat[]>();
  if (tripIds.length === 0) return byTrip;

  const prior = db
    .select({
      personId: bookings.personId,
      lastDivedAt: max(trips.startsAt).as("last_dived_at"),
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        notInArray(bookings.tripId, [...tripIds]),
        ne(bookings.status, "cancelled"),
        lt(trips.startsAt, now),
      ),
    )
    .groupBy(bookings.personId)
    .as("prior");

  const rows = await db
    .select({
      tripId: bookings.tripId,
      bookingId: bookings.id,
      personName: people.fullName,
      sharedAt: bookings.welcomeSharedAt,
      lastDivedAt: prior.lastDivedAt,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .leftJoin(prior, eq(prior.personId, bookings.personId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        inArray(bookings.tripId, [...tripIds]),
        ne(bookings.status, "cancelled"),
        isNotNull(bookings.welcomeSharedAt),
        eq(trips.shopId, shopId),
        liveTrip(),
      ),
    )
    .orderBy(people.fullName, bookings.id);

  for (const row of rows) {
    if (!row.sharedAt) continue;
    const seats = byTrip.get(row.tripId) ?? [];
    seats.push({
      tripId: row.tripId,
      bookingId: row.bookingId,
      personName: row.personName,
      sharedAt: row.sharedAt,
      lastDivedAt: row.lastDivedAt ?? null,
    });
    byTrip.set(row.tripId, seats);
  }
  return byTrip;
}

export type SetWelcomeConsentResult =
  | { ok: true }
  | { ok: false; reason: "unknown_booking" | "trip_over" };

/**
 * The diver's own answer, from their own readiness link, and the only writer of
 * this column — staff have no door to it anywhere.
 *
 * Refused once the boat is home: a consent given to a crew that has already
 * gone ashore has nobody to reach, and letting it be set afterwards would make
 * the stamp look like a standing preference rather than permission for a day.
 * The same one-hour late-arrival buffer every other departure check uses.
 */
export async function setWelcomeConsent(
  db: AppDb,
  input: { shopId: string; bookingId: string; shared: boolean; now?: Date },
): Promise<SetWelcomeConsentResult> {
  const now = input.now ?? nowDate();
  const [booking] = await db
    .select({ id: bookings.id, endsAt: trips.endsAt })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.id, input.bookingId),
        eq(bookings.shopId, input.shopId),
        ne(bookings.status, "cancelled"),
        eq(trips.shopId, input.shopId),
        liveTrip(),
      ),
    )
    .limit(1);
  if (!booking) return { ok: false, reason: "unknown_booking" };
  if (booking.endsAt.getTime() + DEPARTURE_BUFFER_MS < now.getTime()) {
    return { ok: false, reason: "trip_over" };
  }
  await db
    .update(bookings)
    .set({ welcomeSharedAt: input.shared ? now : null })
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)));
  return { ok: true };
}
