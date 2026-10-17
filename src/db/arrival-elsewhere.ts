import { and, asc, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import { HOUR_MS } from "@/lib/clock";
import { type CheckInQueueRow, hasArrivals, listCheckInQueue } from "./check-in";
import type { AppDb, DbExecutor } from "./client";
import { personSearchMatch } from "./person-search";
import { queryAll } from "./query-helpers";
import { bookings, people, trips } from "./schema";
import { liveTrip } from "./trips-live";

/** How many people the fall-through names: a lookup, not a directory. */
const ELSEWHERE_LIMIT = 3;
const MIN_QUERY = 2;

export type ArrivalElsewhere = {
  personId: string;
  fullName: string;
  /** Their next seat on a scheduled departure, or null for nobody booked ahead. */
  next: { tripId: string; tripTitle: string; startsAt: Date } | null;
};

/**
 * **When nobody arriving matches, the shop-wide answer** (fifth loop, item
 * 12). Today's lookup searches the counter's arrivals, so a call about another
 * day read "Nobody arriving matches" and sent the desk to ⌘K. This reads the
 * same people the palette's diver search matches (`personSearchMatch`: name,
 * email, phone) and each one's next seat, so the box under the date can say
 * "Not arriving today. Bjorn Aasen is booked Thu, Oct 15 · 7:00 AM." Reads only,
 * scoped to the shop.
 */
export async function arrivalElsewhere(
  db: DbExecutor,
  shopId: string,
  rawQuery: string,
  now: Date,
): Promise<ArrivalElsewhere[]> {
  const query = rawQuery.trim();
  if (query.length < MIN_QUERY) return [];
  const matched = await db
    .select({ id: people.id, fullName: people.fullName })
    .from(people)
    .where(and(eq(people.shopId, shopId), isNull(people.deletedAt), personSearchMatch(query)))
    .orderBy(people.fullName, people.id)
    .limit(ELSEWHERE_LIMIT);
  if (matched.length === 0) return [];
  const seats = await db
    .select({
      personId: bookings.personId,
      tripId: trips.id,
      tripTitle: trips.title,
      startsAt: trips.startsAt,
    })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .where(
      and(
        eq(bookings.shopId, shopId),
        inArray(
          bookings.personId,
          matched.map((person) => person.id),
        ),
        ne(bookings.status, "cancelled"),
        liveTrip(),
        eq(trips.status, "scheduled"),
        // The palette's "next" reads the same hour back: a boat boarding now
        // is still the seat a caller means.
        gte(trips.startsAt, new Date(now.getTime() - HOUR_MS)),
      ),
    )
    .orderBy(asc(trips.startsAt), asc(trips.title), asc(trips.id));
  const nextByPerson = new Map<string, ArrivalElsewhere["next"]>();
  for (const seat of seats) {
    if (nextByPerson.has(seat.personId)) continue;
    nextByPerson.set(seat.personId, {
      tripId: seat.tripId,
      tripTitle: seat.tripTitle,
      startsAt: seat.startsAt,
    });
  }
  return matched.map((person) => ({
    personId: person.id,
    fullName: person.fullName,
    next: nextByPerson.get(person.id) ?? null,
  }));
}

/**
 * **Today's arrival lookup, in one read**: the arrivals a typed name matches,
 * whether the counter is open at all, and the shop-wide answer for a name
 * nobody arriving matches. With no query only the counter question is asked;
 * with one the counter is open by definition, since somebody typed into it.
 */
export async function readArrivalLookup(
  db: AppDb,
  shopId: string,
  query: string,
  now: Date,
): Promise<{ rows: CheckInQueueRow[]; counterOpen: boolean; elsewhere: ArrivalElsewhere[] }> {
  if (!query) return { rows: [], counterOpen: await hasArrivals(db, shopId, now), elsewhere: [] };
  const [rows, elsewhere] = await queryAll(db, [
    () => listCheckInQueue(db, shopId, { query, now }),
    () => arrivalElsewhere(db, shopId, query, now),
  ]);
  return { rows, counterOpen: true, elsewhere };
}
