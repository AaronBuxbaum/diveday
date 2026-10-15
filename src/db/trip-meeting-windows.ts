import { inArray } from "drizzle-orm";
import { DAY_MS } from "@/lib/clock";
import type { MeetingWindow } from "@/lib/trip-phase";
import type { DbExecutor } from "./client";
import { tripScheduleDays } from "./schema";

/**
 * **The real meeting windows of the multi-day runs among these departures**
 * (`trip_schedule_days`), which the stage rule reads so a tap said inside a
 * window that crosses midnight is not dropped at midnight (issue #2406,
 * `readTap`).
 *
 * A departure shorter than a day is one sailing and never has its windows
 * read: the common case costs no query at all. A run with no windows on file is
 * absent from the map, and the rule keeps its shop-day reading.
 */
export async function meetingWindowsByTrip(
  db: DbExecutor,
  trips: readonly { id: string; startsAt: Date; endsAt: Date }[],
): Promise<Map<string, MeetingWindow[]>> {
  const byTrip = new Map<string, MeetingWindow[]>();
  const multiDay = trips.filter(
    (trip) => trip.endsAt.getTime() - trip.startsAt.getTime() >= DAY_MS,
  );
  if (multiDay.length === 0) return byTrip;
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
        multiDay.map((trip) => trip.id),
      ),
    );
  for (const row of rows) {
    const windows = byTrip.get(row.tripId) ?? [];
    windows.push({ startsAt: row.startsAt, endsAt: row.endsAt });
    byTrip.set(row.tripId, windows);
  }
  return byTrip;
}
