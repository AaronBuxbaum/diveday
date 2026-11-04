import { inArray } from "drizzle-orm";
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
