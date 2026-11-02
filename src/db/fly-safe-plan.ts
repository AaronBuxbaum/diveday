import { and, asc, eq, gt } from "drizzle-orm";
import { DEFAULT_FLY_SAFE_HOURS, type PlannedFlySafe, plannedFlySafeFrom } from "@/lib/fly-safe";
import type { ParticipantType } from "@/lib/participant-types";
import type { DbExecutor } from "./client";
import { diveDay } from "./dive-days";
import { diveDaysBefore } from "./executed-dives";
import { queryAll } from "./query-helpers";
import { bookings, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **When a diver may fly home, read before the boat sails** (fifth-loop ideas,
 * item 18). The rule is `plannedFlySafeFrom`'s; this gathers the two facts
 * about a person it needs: a dive day with this shop in the lookback window
 * (the same reader the recap asks, `diveDaysBefore`, which counts a booked
 * earlier day as well as a sailed one), and this person's next seat with the
 * shop after this departure.
 *
 * Only a diver's seat answers. A snorkeler or a rider never goes under, and
 * DAN's preflight interval is about dives (issue #2383 asks the same of the
 * recap).
 */
type PlannedFlySafeQuery = {
  shop: { id: string };
  person: { id: string };
  participantType: ParticipantType;
  detail: { shop: { timezone: string }; trip: { id: string; startsAt: Date } };
};

export async function readPlannedFlySafe(
  db: DbExecutor,
  input: PlannedFlySafeQuery,
): Promise<PlannedFlySafe | null> {
  return (await gatherPlannedFlySafe(db, input))?.plan ?? null;
}

/**
 * **The night-before reminder's fly-safe hours** (ux-delight sheet
 * 2026-10-22, item 1; H-20261022-reminder-fly-safe-in: the rule in hours, never a clock time). The
 * same plan `/ready` reads, said only when this departure is the diver's
 * last seat with the shop: a diver with any later boat reads it on that
 * boat's reminder instead. Null whenever the plan is (a snorkeler or rider,
 * past no-decompression limits, no scheduled end), as the recap is silent.
 */
export async function readReminderFlySafeHours(
  db: DbExecutor,
  input: PlannedFlySafeQuery,
): Promise<number | null> {
  const gathered = await gatherPlannedFlySafe(db, input);
  if (!gathered?.plan || gathered.nextDiveStartsAt) return null;
  return gathered.plan.hours;
}

async function gatherPlannedFlySafe(
  db: DbExecutor,
  input: PlannedFlySafeQuery,
): Promise<{ plan: PlannedFlySafe | null; nextDiveStartsAt: Date | null } | null> {
  const shopId = input.shop.id;
  const personId = input.person.id;
  const trip = input.detail.trip;
  if (input.participantType !== "diver") return null;

  const [tripRows, recent, next] = await queryAll(db, [
    () =>
      db
        .select({
          endsAt: trips.endsAt,
          plannedDives: trips.plannedDives,
          exceedsNoDecoLimits: trips.exceedsNoDecoLimits,
        })
        .from(trips)
        .where(and(eq(trips.id, trip.id), eq(trips.shopId, shopId), liveTrip()))
        .limit(1),
    () => diveDaysBefore(db, shopId, [personId], trip.startsAt, input.detail.shop.timezone),
    () =>
      db
        .select({ startsAt: trips.startsAt })
        .from(bookings)
        .innerJoin(trips, eq(trips.id, bookings.tripId))
        .where(
          and(
            eq(bookings.shopId, shopId),
            eq(trips.shopId, shopId),
            eq(bookings.personId, personId),
            eq(bookings.participantType, "diver"),
            gt(trips.startsAt, trip.startsAt),
            // The one dive-day rule (`src/db/dive-days.ts`): a live seat, not
            // cancelled or a no-show, on a live departure still scheduled.
            diveDay(),
          ),
        )
        .orderBy(asc(trips.startsAt))
        .limit(1),
  ]);
  const row = tripRows[0];
  if (!row) return null;

  const nextDiveStartsAt = next[0]?.startsAt ?? null;
  const plan = plannedFlySafeFrom({
    plannedDives: row.plannedDives,
    endsAt: row.endsAt,
    divedRecently: recent.dived.has(personId),
    exceedsNoDecoLimits: row.exceedsNoDecoLimits,
    decompressionRecently: recent.decompression.has(personId),
    nextDiveStartsAt,
    hours: DEFAULT_FLY_SAFE_HOURS,
  });
  return { plan, nextDiveStartsAt };
}
