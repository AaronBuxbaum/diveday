import {
  CIVIL_TWILIGHT_ALTITUDE,
  type MoonPhase,
  moonAppearance,
  moonIsUp,
  type SkyPlace,
  SUN_HORIZON_ALTITUDE,
  solarDayNumber,
  solarEventsOn,
} from "./sun-moon";

/**
 * **How dark it will be, and what light the moon leaves.**
 *
 * A night departure is the one kind of dive where the sky is a fact a diver
 * packs around: whether to bring a backup torch, and how much they will be able
 * to see of the reef beyond the beam.
 *
 * **Never a planning input.** Nothing here decides how long a surface interval
 * runs, when a boat turns for home, or whether a gauge can be read — those are
 * the crew's calls, made on the water with the light they actually have, and a
 * number computed ashore that looked like an answer to them would be worse than
 * no number at all.
 *
 * The arithmetic is not here. `src/lib/sun-moon.ts` is the almanac — the solar
 * and lunar series, computed from coordinates and a date with no network call
 * and no dependency — and this file is the one composition that asks it only
 * about a departure that dives after dark. The two used to carry the same
 * series twice.
 *
 * **It informs and gates nothing.** Nothing in `src/lib/trip-admission.ts` or
 * `src/lib/readiness.ts` reads this file; a departure whose shop has never set
 * an address simply carries no line, which is the ordinary case for a shop that
 * has done the least setup.
 *
 * Prose-free, like the rest of `src/lib`: a moon phase leaves here as one of
 * eight codes and becomes a word in `src/i18n/sky-labels.ts`.
 */

export { MOON_PHASES, type MoonPhase, moonAppearance, type SkyPlace } from "./sun-moon";

const MS_PER_DAY = 86_400_000;
/**
 * How finely the dive window is walked when asking what the moon does over it.
 *
 * Ten minutes: the moon crosses the horizon in about two, so no crossing can
 * hide between two samples, and a 3½-hour charter costs about twenty evaluations
 * of a closed-form series.
 */
const MOON_SAMPLE_MS = 10 * 60_000;

/**
 * **What the moon does between leaving the dock and coming home.**
 *
 * Not what it does that calendar day, which is the question the line used to
 * answer by implication and get wrong. A last-quarter moon rises around
 * midnight: a 7:30 PM charter home by 11:00 PM dives the whole of it under a
 * moonless sky, and "Last quarter, 50% lit" then tells a diver they have half a
 * moon of light to pack around when they have none.
 *
 * - `down` — never above the horizon while the boat is out. The line drops the
 *   phase entirely and says so.
 * - `rises` — comes up partway through; the time is worth printing.
 * - `sets` — up when they leave and gone before they are back; that time is
 *   the one worth printing instead.
 * - `up` — up for the whole window, with no crossing to name.
 */
export type MoonOverDive = "down" | "rises" | "sets" | "up";

/** The sky over one departure, once it is dark enough for any of it to matter. */
export type NightSky = {
  /** When the sun sets on the departure's own local day. */
  sunsetAt: Date;
  /**
   * When civil twilight ends and a torch stops being optional, or null at a
   * latitude and season where it never does (a Norwegian summer).
   */
  civilDuskAt: Date | null;
  /**
   * The phase over the departure. Read it **with** `moonOverDive`: on a `down`
   * window it is a true fact about the sky and a misleading one about the dive,
   * which is why the line suppresses it there.
   */
  phase: MoonPhase;
  /** 0-100, rounded — what a diver reads, not what an almanac stores. */
  illuminatedPercent: number;
  /** What the moon does while the boat is out. */
  moonOverDive: MoonOverDive;
  /** When it comes up, when that happens *inside* the dive window. */
  moonriseAt: Date | null;
  /** When it goes down, when that happens *inside* the dive window. */
  moonsetAt: Date | null;
};

/**
 * Walk the dive window and say what the moon did over it, with the one crossing
 * that falls inside it resolved to the minute.
 *
 * A scan rather than a closed form for the reason `moonTimesOn` is a scan: the
 * moon's declination moves several degrees across a day, so there is no hour
 * angle to solve. The bisection afterwards is what turns a ten-minute bracket
 * into a printable time.
 */
function moonOverWindow(
  from: Date,
  to: Date,
  place: SkyPlace,
): { moonOverDive: MoonOverDive; moonriseAt: Date | null; moonsetAt: Date | null } {
  const start = from.getTime();
  const end = Math.max(to.getTime(), start);
  const upAt = (at: number) => moonIsUp(new Date(at), place);
  const upAtStart = upAt(start);
  let crossing: { before: number; after: number } | null = null;
  let previous = start;
  for (let at = start + MOON_SAMPLE_MS; ; at += MOON_SAMPLE_MS) {
    const now = Math.min(at, end);
    if (upAt(now) !== upAtStart) {
      crossing = { before: previous, after: now };
      break;
    }
    previous = now;
    if (now >= end) break;
  }
  if (!crossing) {
    // No crossing: whatever it was doing at the dock, it did for the whole dive.
    return {
      moonOverDive: upAtStart ? "up" : "down",
      moonriseAt: null,
      moonsetAt: null,
    };
  }
  // Bisect the bracket to the minute — twenty halvings of ten minutes is far
  // finer than a printed clock time.
  let low = crossing.before;
  let high = crossing.after;
  while (high - low > 30_000) {
    const middle = Math.round((low + high) / 2);
    if (upAt(middle) === upAtStart) low = middle;
    else high = middle;
  }
  const at = new Date(Math.round(high / 60_000) * 60_000);
  return upAtStart
    ? { moonOverDive: "sets", moonriseAt: null, moonsetAt: at }
    : { moonOverDive: "rises", moonriseAt: at, moonsetAt: null };
}

/**
 * The sky over a departure, or null when there is nothing worth saying.
 *
 * Null in three cases, all ordinary: the shop has never set its coordinates
 * (the address form is optional, and a whole timezone is far too coarse to
 * derive a sunset from — `timeZoneAnchor` is a search *bias*, not a position);
 * the sun does not set at all on that day; or the whole departure runs in
 * daylight.
 *
 * **A departure is a night departure if it is still out at sunset**, which is
 * a wider net than the departure *leaving* after dark. Key Largo's own night
 * charter is the case that settles it: it leaves the dock at 7:30 PM and comes
 * home at 11:00 PM, so in July it casts off a good half-hour before a 8:11 PM
 * sunset and dives both tanks in the dark. Testing the start alone would drop
 * the line from exactly the departure it is written for, six months of the
 * year. A departure that ends before sunset gets nothing, which is every
 * morning two-tank trip on every board.
 *
 * A run spanning more than a day ignores its end and is judged on its start:
 * `endsAt` on a three-day Open Water is the last day's 5:00 PM, which says
 * nothing about whether day one meets in the dark.
 */
export function nightSkyFor(input: {
  startsAt: Date;
  /** When it comes home, when that is known and is the same day's evening. */
  endsAt?: Date | null;
  /** The shop's own zone — the departure's local day is what fixes the date. */
  timeZone: string;
  latitude: number | null;
  longitude: number | null;
}): NightSky | null {
  const { latitude, longitude } = input;
  if (latitude === null || longitude === null) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const place: SkyPlace = { latitude, longitude };
  const dayNumber = solarDayNumber(input.startsAt, input.timeZone);

  const sunsetAt = solarEventsOn(dayNumber, place, SUN_HORIZON_ALTITUDE).setAt;
  if (!sunsetAt) return null;
  const endsAt = input.endsAt ?? null;
  const sameDayEnd =
    endsAt && endsAt.getTime() - input.startsAt.getTime() <= MS_PER_DAY ? endsAt : null;
  const stillOut = (sameDayEnd ?? input.startsAt).getTime();
  if (stillOut < sunsetAt.getTime()) return null;

  const { phase, illuminatedFraction } = moonAppearance(input.startsAt);
  const civilDuskAt = solarEventsOn(dayNumber, place, CIVIL_TWILIGHT_ALTITUDE).setAt;
  // **The dive window, not the day.** It ends when the boat is back; a departure
  // that never said when that is falls back to the moment the sky goes dark,
  // and then to sunset, because that is the earliest instant the moon could
  // matter at all. `sameDayEnd` rather than `endsAt`, so a three-day course's
  // last afternoon never stretches day one's window across seventy hours.
  const moon = moonOverWindow(input.startsAt, sameDayEnd ?? civilDuskAt ?? sunsetAt, place);
  return {
    sunsetAt,
    civilDuskAt,
    phase,
    illuminatedPercent: Math.round(illuminatedFraction * 100),
    ...moon,
  };
}
