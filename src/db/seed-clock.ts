import { calendarDateInTimezone } from "@/lib/calendar-date";
import { DAY_MS, nowDate, nowMs } from "@/lib/clock";
import { shopDayBounds, toDateInputValue, utcToWallTime, wallTimeToUtc } from "@/lib/zoned";

/**
 * The seed's clock.
 *
 * Every date the demo data lands on is computed here, from `nowMs()`/`nowDate()`
 * (`src/lib/clock.ts`) and never from a direct wall-clock read. That is what
 * lets the e2e fleet freeze one instant and get a pixel-identical demo shop on
 * every run: the
 * boat that sails "today", the cert that lapsed last month, and the row order on
 * a roster all move together with `DIVEDAY_CLOCK`, or all stay put without it.
 *
 * `nextCreatedAt`'s counter is module state on purpose — one counter for the
 * whole seed, so the strictly-increasing stamps it hands out are unique across
 * every scenario module, not just within one.
 */

export const DEMO_SHOP_TIMEZONE = "America/New_York";

/**
 * n days from now at the given hour/minute **in the demo shop's own timezone**.
 *
 * This used to set UTC hours, which is not what any caller meant: the shop is
 * in America/New_York, so `at(1, 7)` — written to mean an early boat — sailed
 * at 3:00 AM on every screen that renders it, and the "Sunset Two-Tank" left at
 * noon. Anchoring to the shop's wall clock makes the hour a caller writes the
 * hour a diver reads.
 *
 * The day is the shop's calendar day `daysFromNow` out, resolved before the
 * hour is applied, so a departure lands on the day its caller counted to even
 * when the hour sits either side of UTC midnight.
 */
export function at(daysFromNow: number, hour: number, minute = 0): Date {
  const day = utcToWallTime(new Date(nowMs() + daysFromNow * DAY_MS), DEMO_SHOP_TIMEZONE);
  return wallTimeToUtc({ ...day, hour, minute }, DEMO_SHOP_TIMEZONE);
}

/**
 * n days from now as a date-only "YYYY-MM-DD" (demo cert expiries, CR-009).
 * Uses the UTC calendar date, not the demo shop's own timezone — fine for the
 * multi-week-out/lapsed values seeded today, but do not use this for a
 * boundary-adjacent value (e.g. "expires today") without switching to
 * `calendarDateInTimezone` first.
 */
export function dateAt(daysFromNow: number): string {
  return calendarDateInTimezone(new Date(nowMs() + daysFromNow * DAY_MS), "UTC");
}

/**
 * A birth date chosen so the diver turns exactly `age` on the day `inDays` from
 * the seeded clock — exact calendar arithmetic, not `dateAt`'s day-count
 * approximation, because a birthday callout is precisely the boundary-adjacent
 * case that helper warns against. Anchored to the shop's own timezone so the
 * rendered age and "turns N in 2 days" stay pixel-stable across visual runs.
 */
export function birthDateTurning(age: number, inDays: number): string {
  const wall = utcToWallTime(new Date(nowMs() + inDays * DAY_MS), DEMO_SHOP_TIMEZONE);
  return `${String(wall.year - age).padStart(4, "0")}-${String(wall.month).padStart(2, "0")}-${String(wall.day).padStart(2, "0")}`;
}

/**
 * Distinct, clock-anchored `createdAt` stamps for seed rows whose render
 * order depends on insertion order (a trip roster, a diver's card history).
 * Left to the column's `defaultNow()`, every row in the same multi-row
 * INSERT ties on one transaction-start instant — real wall-clock time, not
 * `DIVEDAY_CLOCK` — and Postgres does not promise a stable order for ties,
 * so which diver renders first drifts between runs. Handing out strictly
 * increasing instants removes the tie.
 */
let seedClockTick = 0;
export function nextCreatedAt(): Date {
  seedClockTick += 1;
  return new Date(nowMs() + seedClockTick);
}

/**
 * Anchored to the clock rather than the calendar so one seeded trip always
 * sails *today*, whatever time the demo is opened. Today's departure board is
 * the first thing staff see, and a demo that never has a boat out cannot show
 * it. Always in the future, so it never falls out of the upcoming schedule.
 */
export function hoursFromNow(hours: number, from = nowDate()): Date {
  const d = new Date(from.getTime() + hours * 60 * 60 * 1000);
  // Round up to the next half hour: dive boats leave at 7:30, not 7:49, and a
  // ragged time reads as a bug in every screenshot of the demo.
  const step = 30 * 60 * 1000;
  return new Date(Math.ceil(d.getTime() / step) * step);
}

/**
 * Start of the seeded departure that must sail *today in the shop's timezone*.
 * Within five hours of local midnight the plain now+5h offset rounds into
 * tomorrow, which empties the departure board the demo (and the Today tests)
 * are built around — so it clamps to the last half-hour slot that still sails
 * today. Even in the final half hour before local midnight, when no
 * half-hour-rounded slot is left, this still returns a same-day moment (the
 * earliest still-future instant) rather than concede to tomorrow: "today
 * always has a board" has no exception.
 */
/** The earliest local hour today's seeded departure leaves: after the dawn boat docks. */
export const DEMO_DAY_FIRST_SAILING_HOUR = 9;

/**
 * The first-light boat's local wall times (`DEMO_COMPLETED_TRIP_TITLE`,
 * `seed-more-trips.ts`), named once so the crew's shift (`demoTodayShifts`)
 * and the boat cannot drift apart.
 */
export const DEMO_DAWN_BOAT = {
  sails: { hour: 5, minute: 30 },
  docks: { hour: 8, minute: 30 },
} as const;

export function demoTodayDepartureStart(
  now = nowDate(),
  timeZone: string = DEMO_SHOP_TIMEZONE,
): Date {
  const localDay = (date: Date) => toDateInputValue(utcToWallTime(date, timeZone));
  // Never before the dawn boat is back. The same captain and divemaster crew
  // `DEMO_COMPLETED_TRIP_TITLE` (5:30 to 8:30 AM, `seed-more-trips.ts`), so a
  // demo seeded in the small hours put them on two boats at once and opened
  // Today on "Crew on two departures" (UX audit 2026-10-07, item 4).
  const firstSlotAfterDawnBoat = wallTimeToUtc(
    { ...utcToWallTime(now, timeZone), hour: DEMO_DAY_FIRST_SAILING_HOUR, minute: 0 },
    timeZone,
  );
  const fiveHoursOut = hoursFromNow(5, now);
  const candidate =
    fiveHoursOut.getTime() < firstSlotAfterDawnBoat.getTime()
      ? firstSlotAfterDawnBoat
      : fiveHoursOut;
  if (localDay(candidate) === localDay(now)) return candidate;
  const lastSlotToday = wallTimeToUtc(
    { ...utcToWallTime(now, timeZone), hour: 23, minute: 30 },
    timeZone,
  );
  if (lastSlotToday.getTime() > now.getTime()) return lastSlotToday;
  const wall = utcToWallTime(now, timeZone);
  const midnight = wallTimeToUtc({ ...wall, day: wall.day + 1, hour: 0, minute: 0 }, timeZone);
  return new Date(Math.min(now.getTime() + 60 * 1000, midnight.getTime() - 1000));
}

/**
 * The latest local wall time a day boat leaves, in minutes after midnight
 * (issue #2440). A demo seeded in the shop's evening has no day-boat slot left
 * today, and `demoTodayDepartureStart` still has to put a boat on today's
 * board, so it sails late; past this time it is named as the night dive it
 * would be (`nameDemoNightDeparture`, `seed-trips.ts`) rather than read as a
 * two-tank reef trip leaving at 11:30 PM.
 */
export const DEMO_DAY_LAST_SAILING_MINUTE = 20 * 60;

/** Whether a departure starting at `startsAt` leaves after the day boats do, in shop time. */
export function sailsAfterDayBoats(startsAt: Date, timeZone: string = DEMO_SHOP_TIMEZONE): boolean {
  const wall = utcToWallTime(startsAt, timeZone);
  return wall.hour * 60 + wall.minute > DEMO_DAY_LAST_SAILING_MINUTE;
}

/** How long today's seeded departure runs, dock to dock (`seed-trips.ts`). */
export const DEMO_TODAY_DEPARTURE_MS = 3.5 * 60 * 60 * 1000;

/**
 * **The one shift every member of the demo cast works today**, on the boat's
 * own local day: an hour before today's departure sails until an hour after it
 * is back, and never past the shop's midnight. It used to be a flat twelve
 * hours from an hour before sailing, so an evening boat put every shift at
 * "5:30 PM – 5:30 AM" (UX review 2026-10-10, item 4).
 */
export function demoTodayShift(
  now = nowDate(),
  timeZone: string = DEMO_SHOP_TIMEZONE,
): { startsAt: Date; endsAt: Date } {
  const hour = 60 * 60 * 1000;
  const sails = demoTodayDepartureStart(now, timeZone);
  const startsAt = new Date(sails.getTime() - hour);
  const dayEnds = shopDayBounds(sails, timeZone).to;
  const endsAt = new Date(
    Math.min(sails.getTime() + DEMO_TODAY_DEPARTURE_MS + hour, dayEnds.getTime()),
  );
  return { startsAt, endsAt };
}

/**
 * **Every shift one member of the demo cast works today.** Everyone gets the
 * shift around today's departure (`demoTodayShift`). The dawn boat's crew
 * (`dawnCrew`: the captain, the divemaster and the assistant who crew it) also
 * work from an hour before it sails to an hour after it docks, 4:30 to 9:30;
 * the shared shift never starts before 8:00, so without this the staffing week
 * flagged the demo's own crew on a boat they were not rostered for
 * (dive-domain review of the demo layer). Where the two touch or overlap they
 * are one shift, because nobody clocks out at 8:00 to clock back in at 8:00.
 */
export function demoTodayShifts(
  now = nowDate(),
  timeZone: string = DEMO_SHOP_TIMEZONE,
  { dawnCrew }: { dawnCrew: boolean },
): { startsAt: Date; endsAt: Date }[] {
  const shared = demoTodayShift(now, timeZone);
  if (!dawnCrew) return [shared];
  const hour = 60 * 60 * 1000;
  const day = utcToWallTime(demoTodayDepartureStart(now, timeZone), timeZone);
  const dawn = {
    startsAt: new Date(
      wallTimeToUtc({ ...day, ...DEMO_DAWN_BOAT.sails }, timeZone).getTime() - hour,
    ),
    endsAt: new Date(wallTimeToUtc({ ...day, ...DEMO_DAWN_BOAT.docks }, timeZone).getTime() + hour),
  };
  if (shared.startsAt.getTime() <= dawn.endsAt.getTime()) {
    return [
      {
        startsAt: dawn.startsAt,
        endsAt: new Date(Math.max(dawn.endsAt.getTime(), shared.endsAt.getTime())),
      },
    ];
  }
  return [dawn, shared];
}
