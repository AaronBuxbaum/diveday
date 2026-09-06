import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { calendarDateInTimezone, calendarDateWeekday } from "@/lib/calendar-date";
import { DAY_MS, nowDate } from "@/lib/clock";
import { cachedFormatter } from "@/lib/intl-cache";
import {
  PATTERN_WEEKS,
  type WeekdayDeparture,
  type WeekdayPattern,
  weekdayPattern,
} from "@/lib/weekday-pattern";
import type { AppDb } from "./client";
import { tripAssignments, trips } from "./schema";
import { liveTrip } from "./trips-live";

/** `HH:MM` on the shop's own clock, for a stored instant. */
function wallClock(instant: Date, timeZone: string): string {
  return cachedFormatter("dt", Intl.DateTimeFormat, "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(instant);
}

/**
 * What the shop ran on this weekday over the last six weeks, as the pattern
 * reader wants it (ADR 20260906-before-you-ask, decision 3). Live departures
 * only — a cancelled or deleted one is not what the shop runs — with each
 * one's crew, so the pattern can offer the pair that usually goes.
 */
export async function departuresOnWeekday(
  db: AppDb,
  shopId: string,
  dateIso: string,
  timeZone: string,
  now = nowDate(),
): Promise<WeekdayDeparture[]> {
  const weekday = calendarDateWeekday(dateIso);
  // A day wider than six weeks of instants: the sixth same-weekday back left
  // in the morning, and "now" is usually the afternoon.
  const since = new Date(now.getTime() - (PATTERN_WEEKS * 7 + 1) * DAY_MS);
  const rows = await db
    .select({
      id: trips.id,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      title: trips.title,
      diveSiteId: trips.diveSiteId,
      boatId: trips.boatId,
      capacity: trips.capacity,
      priceCents: trips.priceCents,
      lensId: trips.lensId,
      diveMode: trips.diveMode,
    })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        liveTrip(),
        gte(trips.startsAt, since),
        lt(trips.startsAt, now),
        eq(trips.status, "scheduled"),
      ),
    );
  const onWeekday = rows.filter(
    (row) => calendarDateWeekday(calendarDateInTimezone(row.startsAt, timeZone)) === weekday,
  );
  if (onWeekday.length === 0) return [];
  const crew = await db
    .select({ tripId: tripAssignments.tripId, personId: tripAssignments.personId })
    .from(tripAssignments)
    .where(
      inArray(
        tripAssignments.tripId,
        onWeekday.map((row) => row.id),
      ),
    );
  const crewByTrip = new Map<string, string[]>();
  for (const row of crew) {
    crewByTrip.set(row.tripId, [...(crewByTrip.get(row.tripId) ?? []), row.personId]);
  }
  return onWeekday.map((row) => ({
    date: calendarDateInTimezone(row.startsAt, timeZone),
    startTime: wallClock(row.startsAt, timeZone),
    endTime: wallClock(row.endsAt, timeZone),
    title: row.title,
    diveSiteId: row.diveSiteId,
    boatId: row.boatId,
    capacity: row.capacity,
    priceCents: row.priceCents,
    lensId: row.lensId,
    diveMode: row.diveMode,
    crewPersonIds: crewByTrip.get(row.id) ?? [],
  }));
}

/** The pattern for a day, read fresh — never cached, so a changed board changes the answer. */
export async function weekdayPatternFor(
  db: AppDb,
  shopId: string,
  dateIso: string,
  timeZone: string,
  now = nowDate(),
): Promise<WeekdayPattern | null> {
  return weekdayPattern(await departuresOnWeekday(db, shopId, dateIso, timeZone, now));
}
