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
 * An instant no earlier than every stamp {@link nextCreatedAt} has handed out,
 * which run a few milliseconds ahead of the clock. A seed that asks readiness
 * mid-run reads at this, so a release it just signed exists by then: readiness
 * leaves out a signature dated after the instant it is asked about (#3002).
 */
export function afterSeedStamps(): Date {
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

/** The earliest local hour today's seeded departure leaves: after the dawn boat docks. */
export const DEMO_DAY_FIRST_SAILING_HOUR = 9;

/** The desk's own day, for the cast who crew nothing when today's boat sails at night. */
export const DEMO_DESK_DAY = {
  opens: { hour: 9, minute: 0 },
  closes: { hour: 17, minute: 0 },
} as const;

/**
 * The first-light boat's local wall times (`DEMO_COMPLETED_TRIP_TITLE`,
 * `seed-more-trips.ts`), named once so the crew's shift (`demoTodayShifts`)
 * and the boat cannot drift apart.
 */
export const DEMO_DAWN_BOAT = {
  sails: { hour: 5, minute: 30 },
  docks: { hour: 8, minute: 30 },
} as const;

/**
 * When the readiness departure sails once the day boats are done: tomorrow,
 * after the shop's 7:00 morning boat (`seed-more-trips.ts`) is back at 10:30
 * with the same crew aboard.
 */
export const DEMO_NEXT_MORNING_SAILING = { hour: 11, minute: 30 } as const;

/**
 * **Start of the demo's readiness departure**: the boat the Today queue, the
 * arrivals desk and the manifest specs are built around, with one diver still
 * to clear.
 *
 * Five hours out, rounded to a half-hour slot, and never before the dawn boat
 * is back (`DEMO_DAY_FIRST_SAILING_HOUR`): the same captain and divemaster
 * crew both, and a demo seeded in the small hours put them on two boats at
 * once (UX audit 2026-10-07, item 4).
 *
 * **Never after the day boats** (market sheet 2026-10-22, item 1). Seeded in
 * the shop's evening, this used to clamp to the last slot before midnight, so
 * the public page led with "Next boat with space · 11:30 PM today" over an
 * "11:30 PM – 3:00 AM" night dive. A shop's next boat after dark is tomorrow
 * morning's, so that is where it sails; the boat at sea that evening is
 * `demoAtSeaDeparture`'s, and the dawn boat keeps today's board from ever
 * being empty.
 */
export function demoTodayDepartureStart(
  now = nowDate(),
  timeZone: string = DEMO_SHOP_TIMEZONE,
): Date {
  const localDay = (date: Date) => toDateInputValue(utcToWallTime(date, timeZone));
  const firstSlotAfterDawnBoat = wallTimeToUtc(
    { ...utcToWallTime(now, timeZone), hour: DEMO_DAY_FIRST_SAILING_HOUR, minute: 0 },
    timeZone,
  );
  const fiveHoursOut = hoursFromNow(5, now);
  const candidate =
    fiveHoursOut.getTime() < firstSlotAfterDawnBoat.getTime()
      ? firstSlotAfterDawnBoat
      : fiveHoursOut;
  if (localDay(candidate) === localDay(now) && !sailsAfterDayBoats(candidate, timeZone)) {
    return candidate;
  }
  const tomorrow = utcToWallTime(new Date(now.getTime() + DAY_MS), timeZone);
  return wallTimeToUtc({ ...tomorrow, ...DEMO_NEXT_MORNING_SAILING }, timeZone);
}

/**
 * The latest local wall time a day boat leaves, in minutes after midnight
 * (issue #2440). Past it, the readiness departure sails tomorrow morning
 * instead (`demoTodayDepartureStart`).
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
 * **Every shift one member of the demo cast works today.** The crew (`crew`:
 * the captain, the divemaster and the assistant, who crew both the dawn boat
 * and the readiness departure) work the shift around that departure
 * (`demoTodayShift`), and from an hour before the dawn boat sails to an hour
 * after it docks, 4:30 to 9:30; the shared shift never starts before 8:00, so
 * without this the staffing week flagged the demo's own crew on a boat they
 * were not rostered for (dive-domain review of the demo layer).
 *
 * Everyone else works the same shift around the readiness departure when it
 * sails today, and the desk's own day when it sails tomorrow: a demo seeded in
 * the evening put the owner and both instructors, who crew nothing, on a
 * "10:30 PM – 12:00 AM" shift beside the crew (UX review 2026-10-13, item 40).
 *
 * The boat at sea's crew (`atSea`) also work from an hour before she sailed
 * to an hour after she is due back (`demoAtSeaDeparture`).
 *
 * Where two shifts touch or overlap they are one, because nobody clocks out
 * at 8:00 to clock back in at 8:00.
 */
export function demoTodayShifts(
  now = nowDate(),
  timeZone: string = DEMO_SHOP_TIMEZONE,
  { crew, atSea = false }: { crew: boolean; atSea?: boolean },
): { startsAt: Date; endsAt: Date }[] {
  const hour = 60 * 60 * 1000;
  const shared = demoTodayShift(now, timeZone);
  const sails = demoTodayDepartureStart(now, timeZone);
  const today = utcToWallTime(now, timeZone);
  const sailsToday = toDateInputValue(utcToWallTime(sails, timeZone)) === toDateInputValue(today);
  const shifts: { startsAt: Date; endsAt: Date }[] = [];
  if (crew) {
    shifts.push(shared, {
      startsAt: new Date(
        wallTimeToUtc({ ...today, ...DEMO_DAWN_BOAT.sails }, timeZone).getTime() - hour,
      ),
      endsAt: new Date(
        wallTimeToUtc({ ...today, ...DEMO_DAWN_BOAT.docks }, timeZone).getTime() + hour,
      ),
    });
  } else if (sailsToday) {
    shifts.push(shared);
  } else {
    shifts.push({
      startsAt: wallTimeToUtc({ ...today, ...DEMO_DESK_DAY.opens }, timeZone),
      endsAt: wallTimeToUtc({ ...today, ...DEMO_DESK_DAY.closes }, timeZone),
    });
  }
  const boat = atSea ? demoAtSeaDeparture(now, timeZone) : null;
  if (boat) {
    const dayEnds = shopDayBounds(boat.startsAt, timeZone).to;
    shifts.push({
      startsAt: new Date(boat.startsAt.getTime() - hour),
      endsAt: new Date(Math.min(boat.endsAt.getTime() + hour, dayEnds.getTime())),
    });
  }
  return mergeShifts(shifts);
}

/** Shifts in order, any two that touch or overlap made one. */
function mergeShifts(
  shifts: readonly { startsAt: Date; endsAt: Date }[],
): { startsAt: Date; endsAt: Date }[] {
  const merged: { startsAt: Date; endsAt: Date }[] = [];
  for (const shift of [...shifts].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
    const last = merged.at(-1);
    if (last && shift.startsAt.getTime() <= last.endsAt.getTime()) {
      last.endsAt = new Date(Math.max(last.endsAt.getTime(), shift.endsAt.getTime()));
    } else {
      merged.push({ startsAt: shift.startsAt, endsAt: shift.endsAt });
    }
  }
  return merged;
}

/** A dive's minutes in the water on the boat at sea, before its count. */
const AT_SEA_DIVE_ONE = { entered: 25, exited: 70, counted: 75 } as const;
/** How long before `now` the boat at sea's second dive went in. */
const AT_SEA_DIVE_TWO_ENTERED_BEFORE_NOW_MIN = 50;
/** How long after dive 2 went in the last pair is planned to be up. */
const AT_SEA_DIVE_TWO_LAST_UP_MIN = 60;
/** How far behind `now` her sailing is placed, before rounding down to a half hour. */
const AT_SEA_SAILED_BEFORE_NOW_MIN = 165;
/** The earliest local time the boat at sea sails. */
const AT_SEA_EARLIEST_SAILING = { hour: 6, minute: 30 } as const;
/** A day boat's last diver is up at least this long before sunset. */
const DAY_BOAT_UP_BEFORE_SUNSET_MIN = 30;
/** The dusk boat's first dive goes in within this long either side of sunset. */
const DUSK_ENTRY_WITHIN_SUNSET_MIN = 20;

/** The demo shop's dock, Key Largo, for its sunset. */
const DEMO_SHOP_LATITUDE = 25.09;
const DEMO_SHOP_LONGITUDE = -80.44;

/**
 * **Sunset at the demo shop's dock** on the shop-local day containing
 * `instant`, from NOAA's general solar position formulas (good to a couple
 * of minutes). The boat at sea is a day boat or the dusk boat by this, not by
 * a fixed clock: Key Largo's sunset moves from about 5:40 PM in December to
 * about 8:15 PM in June (dive-domain review of the demo reseed, item 2).
 */
export function demoSunset(instant: Date, timeZone: string = DEMO_SHOP_TIMEZONE): Date {
  const day = utcToWallTime(instant, timeZone);
  const midnightUtc = Date.UTC(day.year, day.month - 1, day.day);
  const dayOfYear = Math.round((midnightUtc - Date.UTC(day.year, 0, 1)) / DAY_MS) + 1;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1);
  const equationOfTimeMin =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const declination =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const latitude = radians(DEMO_SHOP_LATITUDE);
  const hourAngleDeg =
    (Math.acos(
      Math.cos(radians(90.833)) / (Math.cos(latitude) * Math.cos(declination)) -
        Math.tan(latitude) * Math.tan(declination),
    ) *
      180) /
    Math.PI;
  const sunsetUtcMin = 720 - 4 * (DEMO_SHOP_LONGITUDE - hourAngleDeg) - equationOfTimeMin;
  return new Date(midnightUtc + Math.round(sunsetUtcMin * 60_000));
}

/** The boat at sea's hours and the moments her record is written at. */
export type DemoAtSeaDeparture = {
  startsAt: Date;
  endsAt: Date;
  diveOne: { enteredAt: Date; exitedAt: Date; countedAt: Date };
  /** When the second dive went in; its count is the one still open. */
  diveTwoEnteredAt: Date;
  /** Sails at dusk, so the second dive is in the dark. */
  afterDark: boolean;
};

/**
 * **The boat at sea, halfway through her roll call** (market sheet
 * 2026-10-22, item 1). Whatever hour the demo is opened or reset, one boat is
 * underway with dive 1 counted and dive 2's count open. Every moment is
 * relative to `now`, the instant the demo is seeded, so nothing is written
 * ahead of the clock:
 *
 * - she sailed on a half-hour slot about two and three quarter hours ago,
 *   so the surface interval after dive 1 runs 40 to 70 minutes;
 * - dive 1 went in 25 minutes after the lines came off, came up at 70, and was
 *   counted at 75;
 * - dive 2 went in fifty minutes ago, and most of the boat has surfaced from
 *   it in the last few minutes;
 * - she is due back three and a half hours after sailing, at least a quarter
 *   of an hour from now.
 *
 * Whether she is a day boat or the dusk-and-night two-tank (`afterDark`) is
 * read off that day's sunset (`demoSunset`), never a fixed clock:
 *
 * - a day boat's last pair is up from dive 2 at least half an hour before
 *   sunset, so no second tank turns into an unplanned night dive;
 * - the dusk boat's dive 1 goes in within twenty minutes of sunset, so "at
 *   dusk" is dusk and dive 2 is in the dark.
 *
 * **Null outside the hours a boat is plausibly mid-dive**: before a 6:30 AM
 * sailing, in the evening gap between the two windows, and late at night.
 */
export function demoAtSeaDeparture(
  now = nowDate(),
  timeZone: string = DEMO_SHOP_TIMEZONE,
): DemoAtSeaDeparture | null {
  const minute = 60 * 1000;
  const step = 30 * minute;
  const startsAt = new Date(
    Math.floor((now.getTime() - AT_SEA_SAILED_BEFORE_NOW_MIN * minute) / step) * step,
  );
  const wall = utcToWallTime(startsAt, timeZone);
  const sailsAt = wall.hour * 60 + wall.minute;
  const earliest = AT_SEA_EARLIEST_SAILING.hour * 60 + AT_SEA_EARLIEST_SAILING.minute;
  if (sailsAt < earliest) return null;
  const after = (minutes: number) => new Date(startsAt.getTime() + minutes * minute);
  const diveTwoEnteredAt = new Date(
    now.getTime() - AT_SEA_DIVE_TWO_ENTERED_BEFORE_NOW_MIN * minute,
  );
  const sunset = demoSunset(startsAt, timeZone).getTime();
  const lastUpFromDiveTwo = diveTwoEnteredAt.getTime() + AT_SEA_DIVE_TWO_LAST_UP_MIN * minute;
  const dayBoat = lastUpFromDiveTwo <= sunset - DAY_BOAT_UP_BEFORE_SUNSET_MIN * minute;
  const duskBoat =
    Math.abs(after(AT_SEA_DIVE_ONE.entered).getTime() - sunset) <=
    DUSK_ENTRY_WITHIN_SUNSET_MIN * minute;
  if (!dayBoat && !duskBoat) return null;
  return {
    startsAt,
    endsAt: new Date(startsAt.getTime() + DEMO_TODAY_DEPARTURE_MS),
    diveOne: {
      enteredAt: after(AT_SEA_DIVE_ONE.entered),
      exitedAt: after(AT_SEA_DIVE_ONE.exited),
      countedAt: after(AT_SEA_DIVE_ONE.counted),
    },
    diveTwoEnteredAt,
    afterDark: !dayBoat,
  };
}

/** The desk's day, shop-local: open at 8 AM, last signature by 6 PM. */
const DESK_OPENS_HOUR = 8;
const DESK_CLOSES_HOUR = 18;

/**
 * **A signature a staffer recorded happened while the desk was open** (fifth
 * loop, section 6). `signedAtFor`'s day 0 is "a few minutes ago", which is a
 * fine time for a diver to sign at home and a false one for a release the
 * counter took on paper: a demo opened just after midnight printed "signed
 * Oct 13, 11:24 PM. Recorded by staff from an in-person signature." on the
 * departure log an insurer reads. The history back-fill's paper releases,
 * signed the evening before, had the same fault. An instant outside desk hours moves back to
 * the last hour the desk was open, keeping its minute and its tie-breaking
 * millisecond, so it stays in the past and stays unique.
 */
export function withinDeskHours(instant: Date, timeZone: string = DEMO_SHOP_TIMEZONE): Date {
  const wall = utcToWallTime(instant, timeZone);
  if (wall.hour >= DESK_OPENS_HOUR && wall.hour < DESK_CLOSES_HOUR) return instant;
  const day =
    wall.hour < DESK_OPENS_HOUR
      ? utcToWallTime(new Date(instant.getTime() - DAY_MS), timeZone)
      : wall;
  const closing = wallTimeToUtc(
    {
      year: day.year,
      month: day.month,
      day: day.day,
      hour: DESK_CLOSES_HOUR - 1,
      minute: wall.minute,
    },
    timeZone,
  );
  return new Date(closing.getTime() + (instant.getTime() % 1_000));
}
