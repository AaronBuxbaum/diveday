/**
 * **Which boats and which kinds of day make money** (fifth loop, item 26).
 *
 * Pure grouping over the month's departures as `getMonthlyReport` returns
 * them, each already carrying its own net (`netCents`: the departure's
 * collected money less tax and pass-through, the month figure's own basis).
 * Wages stay out, as the ledger already decides: DiveDay does not know what a
 * shop pays anybody, so a boat's figure is what it took, never what it made.
 */

import { calendarDateInTimezone } from "./calendar-date";
import type { ReportTrip } from "./reporting";

type MoneyTrip = Pick<
  ReportTrip,
  "startsAt" | "capacity" | "activeBookings" | "netCents" | "boatName" | "kindName" | "isCourse"
>;

/** One hull's month: days at sea, seats sold of seats offered, and what it took. */
export type BoatMonth = {
  name: string;
  /** Days, not departures: a boat out twice in a day was at sea once. */
  days: number;
  booked: number;
  seats: number;
  netCents: number;
};

/**
 * The month by hull, highest take first. A departure that named no boat
 * belongs to no hull's line, the year view's rule, so the lines may sum to
 * less than the month.
 */
export function moneyByBoat(trips: readonly MoneyTrip[], timeZone: string): BoatMonth[] {
  const byName = new Map<string, BoatMonth & { dayKeys: Set<string> }>();
  for (const trip of trips) {
    if (!trip.boatName) continue;
    const boat = byName.get(trip.boatName) ?? {
      name: trip.boatName,
      days: 0,
      booked: 0,
      seats: 0,
      netCents: 0,
      dayKeys: new Set<string>(),
    };
    boat.dayKeys.add(calendarDateInTimezone(trip.startsAt, timeZone));
    boat.booked += trip.activeBookings;
    boat.seats += trip.capacity;
    boat.netCents += trip.netCents ?? 0;
    byName.set(trip.boatName, boat);
  }
  return [...byName.values()]
    .map(({ dayKeys, ...boat }) => ({ ...boat, days: dayKeys.size }))
    .sort((left, right) => right.netCents - left.netCents || left.name.localeCompare(right.name));
}

/** A kind of day: the shop's own lens word, a course, or neither. */
export type DayKind = { kind: "lens"; name: string } | { kind: "course" } | { kind: "other" };

export type KindMonth = { kind: DayKind; netCents: number };

/**
 * The month by kind of day, highest take first. A course session is "a
 * course" whatever lens it wears; a departure with neither is "other". Empty
 * when no departure of the month named a kind at all, because a single
 * "other" line restates the month's total.
 */
export function moneyByKind(trips: readonly MoneyTrip[]): KindMonth[] {
  const named = trips.some((trip) => trip.isCourse || trip.kindName);
  if (!named) return [];
  const byKey = new Map<string, KindMonth>();
  for (const trip of trips) {
    const kind: DayKind = trip.isCourse
      ? { kind: "course" }
      : trip.kindName
        ? { kind: "lens", name: trip.kindName }
        : { kind: "other" };
    const key = kind.kind === "lens" ? `lens:${kind.name}` : kind.kind;
    const line = byKey.get(key) ?? { kind, netCents: 0 };
    line.netCents += trip.netCents ?? 0;
    byKey.set(key, line);
  }
  return [...byKey.values()].sort((left, right) => right.netCents - left.netCents);
}
