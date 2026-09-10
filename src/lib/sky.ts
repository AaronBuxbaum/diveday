import {
  CIVIL_TWILIGHT_ALTITUDE,
  type MoonPhase,
  moonAppearance,
  type SkyPlace,
  SUN_HORIZON_ALTITUDE,
  solarDayNumber,
  solarEventsOn,
} from "./sun-moon";

/**
 * **How dark it will be, and what light the moon leaves.**
 *
 * A night departure is the one kind of dive where the sky is an operational
 * fact: a diver deciding whether to bring a backup torch, a shop deciding how
 * long the surface interval can run in usable light.
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

/** The sky over one departure, once it is dark enough for any of it to matter. */
export type NightSky = {
  /** When the sun sets on the departure's own local day. */
  sunsetAt: Date;
  /**
   * When civil twilight ends and a torch stops being optional, or null at a
   * latitude and season where it never does (a Norwegian summer).
   */
  civilDuskAt: Date | null;
  phase: MoonPhase;
  /** 0-100, rounded — what a diver reads, not what an almanac stores. */
  illuminatedPercent: number;
};

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
  return {
    sunsetAt,
    civilDuskAt: solarEventsOn(dayNumber, place, CIVIL_TWILIGHT_ALTITUDE).setAt,
    phase,
    illuminatedPercent: Math.round(illuminatedFraction * 100),
  };
}
