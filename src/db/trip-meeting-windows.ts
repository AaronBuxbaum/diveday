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
  trips: readonly { id: string; startsAt: Date; endsAt: Date }[],
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
    select max(day_start.boundary) from (
      -- Day one has no boundary: no day before it. (least() would skip the null.)
      select case when lag(d.ends_at) over w is null then null else least(
        d.starts_at,
        d.starts_at - (d.starts_at - lag(d.ends_at) over w) / 2
      ) end as boundary
      from ${tripScheduleDays} d
      -- Spelled out: inside a subquery a bare column name would bind to "d".
      where d.trip_id = "roll_call_events"."trip_id"
      window w as (order by d.starts_at)
    ) day_start
    where day_start.boundary <= ${now.toISOString()}::timestamptz
  ), '-infinity'::timestamptz)`;
}
