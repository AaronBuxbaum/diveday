import { and, asc, eq, gte, lt } from "drizzle-orm";
import type { DbExecutor } from "@/db/client";
import { courses, diveSites, people, tripAssignments, tripScheduleDays, trips } from "@/db/schema";
import { liveTrip } from "@/db/trips-live";
import { nowDate } from "@/lib/clock";
import type { FeedTrip } from "./feed-document";
import type { FeedScope } from "./feed-store";

/**
 * How far back and forward a feed publishes. A subscribing calendar re-reads
 * the whole document every poll, so an unbounded feed would grow without limit
 * and re-send years of history on every fetch. The past window exists so a
 * just-finished trip doesn't vanish from the calendar mid-morning.
 */
export const FEED_PAST_DAYS = 14;
export const FEED_FUTURE_DAYS = 180;

/**
 * The departures a feed covers, one entry per scheduled day.
 *
 * Cancelled trips are excluded rather than published as cancelled events:
 * METHOD:PUBLISH has no reliable cancellation verb across Google, Apple, and
 * Outlook, so dropping the UID is what actually removes it from the
 * subscriber's calendar.
 *
 * **No diver ever appears in a feed.** The selection below reaches trips,
 * courses, dive sites, and `trip_assignments` — the crew — and deliberately
 * never touches `bookings`. A feed URL is a bearer credential that will be
 * pasted into Google's servers and synced to a phone, so the roster (with its
 * names, and one join away its medical and waiver state) has no business in
 * it. `feed-trips.test.ts` asserts this; do not add a roster here.
 */
export async function listFeedTrips(
  db: DbExecutor,
  input: { shopId: string; personId: string; scope: FeedScope; now?: Date },
): Promise<FeedTrip[]> {
  const now = input.now ?? nowDate();
  const from = new Date(now.getTime() - FEED_PAST_DAYS * 24 * 60 * 60 * 1000);
  const until = new Date(now.getTime() + FEED_FUTURE_DAYS * 24 * 60 * 60 * 1000);

  const conditions = [
    eq(trips.shopId, input.shopId),
    eq(trips.status, "scheduled"),
    gte(trips.endsAt, from),
    lt(trips.startsAt, until),
  ];

  const rows = await db
    .select({
      tripId: trips.id,
      title: trips.title,
      tripStartsAt: trips.startsAt,
      tripEndsAt: trips.endsAt,
      courseTitle: courses.title,
      siteName: diveSites.name,
      dayNumber: tripScheduleDays.dayNumber,
      dayStartsAt: tripScheduleDays.startsAt,
      dayEndsAt: tripScheduleDays.endsAt,
      crewName: people.fullName,
      crewPersonId: tripAssignments.personId,
    })
    .from(trips)
    .leftJoin(courses, eq(courses.id, trips.courseId))
    .leftJoin(diveSites, eq(diveSites.id, trips.diveSiteId))
    // Left, not inner: a trip with no `trip_schedule_days` rows is a
    // single-day trip whose span lives on the trip row itself. An inner join
    // silently drops those, which for a calendar means a captain's departure
    // is simply missing — the exact failure this feature exists to prevent.
    .leftJoin(tripScheduleDays, eq(tripScheduleDays.tripId, trips.id))
    .leftJoin(tripAssignments, eq(tripAssignments.tripId, trips.id))
    .leftJoin(people, eq(people.id, tripAssignments.personId))
    .where(and(...conditions, liveTrip()))
    .orderBy(asc(trips.startsAt), asc(tripScheduleDays.dayNumber), asc(people.fullName));

  // A row is (trip × day × crew member), so fold back to one entry per
  // trip-day carrying the whole crew list.
  const byKey = new Map<string, FeedTrip>();
  const crewByKey = new Map<string, Set<string>>();
  const assignedTrips = new Set<string>();

  for (const row of rows) {
    if (row.crewPersonId === input.personId) assignedTrips.add(row.tripId);
    const key = `${row.tripId}:${row.dayNumber ?? "single"}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        tripId: row.tripId,
        dayNumber: row.dayNumber,
        title: row.title,
        courseTitle: row.courseTitle,
        startsAt: row.dayStartsAt ?? row.tripStartsAt,
        endsAt: row.dayEndsAt ?? row.tripEndsAt,
        location: row.siteName,
        crew: [],
      });
    }
    if (row.crewName) {
      const crew = crewByKey.get(key) ?? new Set<string>();
      crew.add(row.crewName);
      crewByKey.set(key, crew);
    }
  }

  const all = [...byKey.entries()].map(([key, trip]) => ({
    ...trip,
    crew: [...(crewByKey.get(key) ?? [])].sort((a, b) => a.localeCompare(b)),
  }));

  const scoped =
    input.scope === "shop_trips" ? all : all.filter((trip) => assignedTrips.has(trip.tripId));

  return scoped.sort(
    (a, b) =>
      a.startsAt.getTime() - b.startsAt.getTime() || (a.dayNumber ?? 0) - (b.dayNumber ?? 0),
  );
}
