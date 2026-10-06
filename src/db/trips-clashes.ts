import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { type AnyPgColumn, alias } from "drizzle-orm/pg-core";
import { nowDate } from "@/lib/clock";
import { hasReturned } from "@/lib/trips";
import type { AppDb } from "./client";
import { boats, tripScheduleDays, trips } from "./schema";
import { liveTrip } from "./trips-live";
import { tripShiftPlan } from "./trips-schedule";

/**
 * **Two departures in each other's way** — the overlap rule both clash readers
 * share, and the boat half of it (H-80, issue #1780).
 *
 * ## One predicate
 *
 * A clash is a **half-open time overlap** of the windows two departures
 * actually occupy: each leg of a multi-day course where it has one, the
 * departure's own window where it does not. Never a shared calendar day — a
 * divemaster on the 08:00 and the 14:00 is a Saturday, and a hull that ties up
 * at 12:00 and takes the 12:00 out is the plan rather than a defect, which is
 * why the comparison is strict on both ends (`startsAt < other.endsAt` and
 * `endsAt > other.startsAt`): nose to tail does not touch.
 *
 * {@link windowsOverlap} is that predicate and {@link legWindow} is the window
 * it is asked of, so the crew clash (`src/db/trips-crew.ts`) and the boat clash
 * below cannot come to different answers about the same pair of departures.
 *
 * ## One hull, one departure at a time
 *
 * H-80 settled the product question #1780 asked: a boat is on one departure at
 * a time. A shop wanting a course group and a fun-dive group on one charter
 * models it as **one** departure, which is what a manifest with groups is for.
 * So two overlapping departures naming the same `boat_id` are a mistake worth
 * naming — on the move preview before it happens, and on each departure's own
 * page while it stands.
 *
 * A departure with **no boat** clashes with nothing: `boat_id = boat_id` is
 * never true of a null in SQL, and {@link boatClashesByTrip} says so out loud
 * with `isNotNull` rather than leaning on that. Two shore dives are not two
 * hulls.
 *
 * **Information, not a gate**, like the crew clash beside it. Nothing here
 * refuses a write; the owner decides, and the sentence is what they were never
 * shown. **Reads only, never a row**: the answer is recomputed every time, so
 * there is nothing to clear when a boat is reassigned.
 */

/** One window a departure occupies — its own, or the one a move proposes. */
export type DepartureWindow = { startsAt: Date; endsAt: Date };

type WindowColumns = {
  startsAt: SQL;
  endsAt: SQL;
};

/**
 * The window a row of `trips` (or an alias of it) occupies, leg by leg: its
 * `trip_schedule_days` row where the join found one, the departure's own window
 * where it did not.
 */
export function legWindow(
  day: { startsAt: AnyPgColumn; endsAt: AnyPgColumn },
  trip: { startsAt: AnyPgColumn; endsAt: AnyPgColumn },
): WindowColumns {
  return {
    startsAt: sql`coalesce(${day.startsAt}, ${trip.startsAt})`,
    endsAt: sql`coalesce(${day.endsAt}, ${trip.endsAt})`,
  };
}

/**
 * **The overlap question.** Half-open on both sides, so a boat that ties up at
 * 12:00 and a boat that sails at 12:00 never meet. `window` is either another
 * departure's {@link legWindow} or a concrete window a move proposes.
 */
export function windowsOverlap(
  leg: WindowColumns,
  window: WindowColumns | DepartureWindow,
): SQL | undefined {
  return and(lt(leg.startsAt, window.endsAt), gt(leg.endsAt, window.startsAt));
}

/**
 * Where a departure would be if a move landed it at `newStartsAt` — every leg,
 * shifted by the same wall-clock delta `moveTrip` applies, from the same
 * function, so a preview and the move cannot disagree about where the boat
 * lands. Null when the departure is not this shop's or is off the board.
 */
export async function proposedDepartureWindows(
  db: AppDb,
  shopId: string,
  tripId: string,
  newStartsAt: Date,
  timeZone: string,
): Promise<DepartureWindow[] | null> {
  if (Number.isNaN(newStartsAt.getTime())) return null;
  const [trip] = await db
    .select({ startsAt: trips.startsAt, endsAt: trips.endsAt })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  if (!trip) return null;
  const shift = tripShiftPlan(trip.startsAt, newStartsAt, timeZone);
  const days = await db
    .select({ startsAt: tripScheduleDays.startsAt, endsAt: tripScheduleDays.endsAt })
    .from(tripScheduleDays)
    .where(eq(tripScheduleDays.tripId, tripId));
  return (days.length > 0 ? days : [{ startsAt: trip.startsAt, endsAt: trip.endsAt }]).map(
    (day) => ({ startsAt: shift(day.startsAt), endsAt: shift(day.endsAt) }),
  );
}

/** Another departure on the same hull at overlapping hours. */
export type BoatClash = {
  otherTripId: string;
  /** The other departure, named — never "another departure". */
  otherTitle: string;
  /** The hull both are on, as the fleet names it. */
  boatName: string;
};

/**
 * **The boat clash each of these departures is standing in right now**, in
 * one query for all of them — the departure page asks for one, and any surface
 * that lists a day asks for its boats at once rather than once per boat.
 *
 * Both sides must be live and `scheduled` (a called-off departure holds no
 * hull), and a subject departure already **home** reports nothing: a clash on
 * last month's charter is permanent, unfixable and true, which is the warning a
 * shop learns to scroll past (`hasReturned`, the one "has the boat come back"
 * rule the crew clash shares).
 *
 * One entry per other departure, however many legs either side has. Tenancy is
 * proved on both sides through `trips.shop_id`, and on the boat through
 * `boats.shop_id`.
 */
export async function boatClashesByTrip(
  db: AppDb,
  shopId: string,
  tripIds: readonly string[],
  now: Date = nowDate(),
): Promise<Map<string, BoatClash[]>> {
  const byTrip = new Map<string, BoatClash[]>();
  if (tripIds.length === 0) return byTrip;

  const subject = alias(trips, "subject_trip");
  const subjectDay = alias(tripScheduleDays, "subject_day");
  const rows = await db
    .select({
      tripId: subject.id,
      subjectEndsAt: subject.endsAt,
      otherTripId: trips.id,
      otherTitle: trips.title,
      boatName: boats.name,
    })
    .from(subject)
    .leftJoin(subjectDay, eq(subjectDay.tripId, subject.id))
    .innerJoin(boats, and(eq(boats.id, subject.boatId), eq(boats.shopId, shopId)))
    .innerJoin(
      trips,
      and(eq(trips.boatId, subject.boatId), ne(trips.id, subject.id), eq(trips.shopId, shopId)),
    )
    .leftJoin(tripScheduleDays, eq(tripScheduleDays.tripId, trips.id))
    .where(
      and(
        inArray(subject.id, [...tripIds]),
        eq(subject.shopId, shopId),
        eq(subject.status, "scheduled"),
        isNull(subject.deletedAt),
        isNotNull(subject.boatId),
        liveTrip(),
        eq(trips.status, "scheduled"),
        windowsOverlap(legWindow(tripScheduleDays, trips), legWindow(subjectDay, subject)),
      ),
    )
    .orderBy(asc(trips.startsAt), asc(trips.id));

  const seen = new Set<string>();
  for (const row of rows) {
    if (hasReturned(row.subjectEndsAt, now)) continue;
    // The left joins repeat a row per pair of legs; the pair of departures is
    // the fact.
    const key = `${row.tripId}:${row.otherTripId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = byTrip.get(row.tripId) ?? [];
    list.push({ otherTripId: row.otherTripId, otherTitle: row.otherTitle, boatName: row.boatName });
    byTrip.set(row.tripId, list);
  }
  return byTrip;
}

/** {@link boatClashesByTrip} for one departure — its own page's read. */
export async function boatClashes(
  db: AppDb,
  shopId: string,
  tripId: string,
  now: Date = nowDate(),
): Promise<BoatClash[]> {
  return (await boatClashesByTrip(db, shopId, [tripId], now)).get(tripId) ?? [];
}

/**
 * **What a move would put the hull on top of** — the boat half of the move
 * preview (`getMovePreflight`), asked of the windows the move proposes rather
 * than the ones the departure has. Same predicate, same both-sides-scheduled
 * rule as the standing read; no "is it home" bound, because a move is always
 * about where the boat is going.
 */
export async function boatMoveClashes(
  db: AppDb,
  shopId: string,
  tripId: string,
  newStartsAt: Date,
  timeZone: string,
): Promise<BoatClash[]> {
  const [trip] = await db
    .select({ boatId: trips.boatId, boatName: boats.name })
    .from(trips)
    .innerJoin(boats, and(eq(boats.id, trips.boatId), eq(boats.shopId, shopId)))
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  if (!trip?.boatId) return [];
  const proposed = await proposedDepartureWindows(db, shopId, tripId, newStartsAt, timeZone);
  if (!proposed || proposed.length === 0) return [];

  const rows = await db
    .select({ otherTripId: trips.id, otherTitle: trips.title })
    .from(trips)
    .leftJoin(tripScheduleDays, eq(tripScheduleDays.tripId, trips.id))
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        eq(trips.boatId, trip.boatId),
        ne(trips.id, tripId),
        or(...proposed.map((window) => windowsOverlap(legWindow(tripScheduleDays, trips), window))),
      ),
    )
    .orderBy(asc(trips.startsAt), asc(trips.id));

  const seen = new Set<string>();
  const clashes: BoatClash[] = [];
  for (const row of rows) {
    if (seen.has(row.otherTripId)) continue;
    seen.add(row.otherTripId);
    clashes.push({ ...row, boatName: trip.boatName });
  }
  return clashes;
}
