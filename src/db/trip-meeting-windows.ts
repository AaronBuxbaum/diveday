import { inArray, type SQL, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { MeetingWindow } from "@/lib/trip-phase";
import type { DbExecutor } from "./client";
import { tripScheduleDays } from "./schema";

/**
 * **The real meeting windows of the multi-day runs among these departures**
 * (`trip_schedule_days`), which the stage rule reads so a tap said inside a
 * window that crosses midnight is not dropped at midnight (issue #2406,
 * `readTap`).
 *
 * No departure is skipped for being short: a course on two consecutive days
 * (Saturday 14:00-18:00, Sunday 08:00-10:00) is under 24 hours end to end and
 * still meets on two days. One query covers every departure asked about. A run
 * with no windows on file is absent from the map, and the rule keeps its
 * shop-day reading.
 */
export async function meetingWindowsByTrip(
  db: DbExecutor,
  trips: readonly { id: string }[],
): Promise<Map<string, MeetingWindow[]>> {
  const byTrip = new Map<string, MeetingWindow[]>();
  if (trips.length === 0) return byTrip;
  const rows = await db
    .select({
      tripId: tripScheduleDays.tripId,
      startsAt: tripScheduleDays.startsAt,
      endsAt: tripScheduleDays.endsAt,
    })
    .from(tripScheduleDays)
    .where(
      inArray(
        tripScheduleDays.tripId,
        trips.map((trip) => trip.id),
      ),
    );
  for (const row of rows) {
    const windows = byTrip.get(row.tripId) ?? [];
    windows.push({ startsAt: row.startsAt, endsAt: row.endsAt });
    byTrip.set(row.tripId, windows);
  }
  return byTrip;
}

/**
 * **Only the roll call of the meeting day being counted now** (#2557), as a
 * condition on `roll_call_events`: for a departure with several meeting days,
 * results taken from that day's boundary on; for a departure with one day (or
 * none on file), everything, exactly as before. The boundary is
 * `rollCallDayStarts`'s (src/lib/trip-days.ts) in SQL: halfway between the
 * day before's end and the day's start, never after that start, and the
 * latest such boundary already passed. One correlated subquery, so a reader
 * that asks it sends no extra statement.
 *
 * The readers of "who is aboard now" take it (the manifest's own count, the
 * desk's boarded list, Today's boats out), so a course's second Saturday
 * starts its count empty instead of showing the first Saturday's as done. The
 * question "is anybody still missing" does not: a person recorded not back
 * aboard on day one stays missing until they are counted again
 * (`listRollCallGaps`, `listUnaccountedForByTrip`).
 */
export function currentMeetingDayMarks(now: Date = nowDate()): SQL {
  return sql`"roll_call_events"."occurred_at" >= coalesce((
    select max(day_start.boundary) from ${dayBoundaries()} day_start
    where day_start.boundary <= ${now.toISOString()}::timestamptz
  ), '-infinity'::timestamptz)`;
}

/**
 * Each later meeting day's roll-call boundary for the row's departure, as a
 * derived table (`boundary`, null for day one). `rollCallDayStarts`'s rule in
 * SQL; correlated on `roll_call_events.trip_id`, spelled out because inside a
 * subquery a bare column name would bind to "d".
 */
function dayBoundaries(): SQL {
  return sql`(
    select case when lag(d.ends_at) over w is null then null else least(
      d.starts_at,
      d.starts_at - (d.starts_at - lag(d.ends_at) over w) / 2
    ) end as boundary
    from ${tripScheduleDays} d
    where d.trip_id = "roll_call_events"."trip_id"
    window w as (order by d.starts_at)
  )`;
}

/**
 * **The meeting day a roll-call result belongs to** (0-based, `rollCallDayOf`
 * in SQL): how many day boundaries its `occurred_at` has passed. 0 for every
 * result on a one-day departure.
 */
export function rollCallDayIndex(): SQL<number> {
  return sql<number>`(
    select count(*)::int from ${dayBoundaries()} b
    where b.boundary <= "roll_call_events"."occurred_at"
  )`;
}

/**
 * **Marks on the same meeting day as `at`**, as a condition on
 * `roll_call_events` (issue #3905): the newest-wins compare of an offline mark
 * reads only these, because a checkpoint such as `after_dive_1` repeats on
 * every day of a course and Sunday's count must not refuse Saturday's queued
 * tap. A one-day departure has one day, so every mark qualifies, as before.
 * Both sides are `rollCallDayOf`'s rule in SQL, over the row's own departure.
 */
export function onSameMeetingDayAs(at: Date): SQL {
  return sql`${rollCallDayIndex()} = ${rollCallCurrentDayIndex(at)}`;
}

/** The meeting day being counted at `now` for the row's departure (0-based). */
export function rollCallCurrentDayIndex(now: Date = nowDate()): SQL<number> {
  return sql<number>`(
    select count(*)::int from ${dayBoundaries()} b
    where b.boundary <= ${now.toISOString()}::timestamptz
  )`;
}
