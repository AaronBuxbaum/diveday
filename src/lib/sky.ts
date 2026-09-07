import { utcToWallTime, wallTimeToUtc } from "./zoned";

/**
 * **How dark it will be, and what light the moon leaves.**
 *
 * A night departure is the one kind of dive where the sky is an operational
 * fact: a diver deciding whether to bring a backup torch, a shop deciding how
 * long the surface interval can run in usable light. Every number here is
 * computed from the shop's own coordinates and a calendar date, with no network
 * call and no dependency — the standard low-precision solar and lunar series,
 * which land sunset and civil dusk inside a minute and the moon's illuminated
 * fraction inside a percentage point or two. A dive briefing needs far less
 * than that.
 *
 * **It informs and gates nothing.** Nothing in `src/lib/trip-admission.ts` or
 * `src/lib/readiness.ts` reads this file; a departure whose shop has never set
 * an address simply carries no line, which is the ordinary case for a shop that
 * has done the least setup.
 *
 * Prose-free, like the rest of `src/lib`: a moon phase leaves here as one of
 * eight codes and becomes a word in `src/i18n/sky-labels.ts`.
 */

/**
 * The eight phases, new moon first and running forwards through the month —
 * the order the moon actually walks them, so a reader scanning the list sees
 * the cycle rather than an alphabet.
 */
export const MOON_PHASES = [
  "new",
  "waxingCrescent",
  "firstQuarter",
  "waxingGibbous",
  "full",
  "waningGibbous",
  "lastQuarter",
  "waningCrescent",
] as const;

export type MoonPhase = (typeof MOON_PHASES)[number];

/** Where the shop is, in signed degrees. */
export type SkyPlace = { latitude: number; longitude: number };

const DEG = Math.PI / 180;
const MS_PER_DAY = 86_400_000;
/** Julian day of 2000-01-01 12:00 UT — the epoch every series below counts from. */
const J2000 = 2_451_545.0;
/** Julian day at the Unix epoch, so an instant converts with one multiply. */
const UNIX_EPOCH_JD = 2_440_587.5;
/** Earth's obliquity, degrees. */
const OBLIQUITY = 23.4397;
/**
 * The sun's altitude at the moment it "sets": half a degree of solar disc plus
 * about 34 arcminutes of atmospheric refraction, which is the convention every
 * published sunset table uses.
 */
const SUNSET_ALTITUDE = -0.833;
/** Civil twilight ends when the sun's centre reaches six degrees below the horizon. */
const CIVIL_DUSK_ALTITUDE = -6;

function julianDay(instant: Date): number {
  return instant.getTime() / MS_PER_DAY + UNIX_EPOCH_JD;
}

function instantFromJulianDay(jd: number): Date {
  return new Date(Math.round((jd - UNIX_EPOCH_JD) * MS_PER_DAY));
}

/** Degrees folded into [0, 360). */
function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

/**
 * When the sun sinks past `altitude` on the evening side of one solar day, for
 * one place, or null when it never reaches it — a polar summer where it never
 * sets, a polar winter where it never rises, or a white night where it sets but
 * never falls six degrees under. Null is a real answer: the caller renders
 * nothing rather than a fabricated time.
 *
 * The series is the standard one (the "sunrise equation" in its usual form):
 * mean solar time corrected for longitude, the sun's mean anomaly, the equation
 * of the centre, then the hour angle at the wanted altitude. `dayNumber` counts
 * whole days from J2000 and fixes which solar day is being asked about.
 */
function solarEventAt(dayNumber: number, place: SkyPlace, altitude: number): Date | null {
  // Mean solar time at this longitude, in days from J2000.
  const meanSolarTime = dayNumber - place.longitude / 360;
  const meanAnomaly = normalizeDegrees(357.5291 + 0.98560028 * meanSolarTime);
  const center =
    1.9148 * Math.sin(meanAnomaly * DEG) +
    0.02 * Math.sin(2 * meanAnomaly * DEG) +
    0.0003 * Math.sin(3 * meanAnomaly * DEG);
  // Argument of perihelion (102.9372) plus the half-turn that puts the sun
  // opposite the earth's own ecliptic longitude.
  const eclipticLongitude = normalizeDegrees(meanAnomaly + center + 180 + 102.9372);
  const transit =
    J2000 +
    meanSolarTime +
    0.0053 * Math.sin(meanAnomaly * DEG) -
    0.0069 * Math.sin(2 * eclipticLongitude * DEG);
  const declination = Math.asin(Math.sin(eclipticLongitude * DEG) * Math.sin(OBLIQUITY * DEG));
  const cosHourAngle =
    (Math.sin(altitude * DEG) - Math.sin(place.latitude * DEG) * Math.sin(declination)) /
    (Math.cos(place.latitude * DEG) * Math.cos(declination));
  // Outside [-1, 1] the sun never crosses this altitude on this day.
  if (cosHourAngle < -1 || cosHourAngle > 1) return null;
  const hourAngle = Math.acos(cosHourAngle) / DEG;
  return instantFromJulianDay(transit + hourAngle / 360);
}

/**
 * The moon's phase and illuminated fraction at an instant.
 *
 * Mean elongation names the phase (it walks 0° at new moon to 180° at full and
 * back), and Meeus' low-precision phase-angle series gives the illuminated
 * fraction — the correction terms are what stop a moon three days past full
 * from being reported as half lit.
 */
export function moonAppearance(at: Date): { phase: MoonPhase; illuminatedFraction: number } {
  const centuries = (julianDay(at) - J2000) / 36_525;
  const elongation = normalizeDegrees(297.8501921 + 445_267.1114034 * centuries);
  const sunAnomaly = normalizeDegrees(357.5291092 + 35_999.0502909 * centuries);
  const moonAnomaly = normalizeDegrees(134.9633964 + 477_198.8675055 * centuries);
  const phaseAngle =
    180 -
    elongation -
    6.289 * Math.sin(moonAnomaly * DEG) +
    2.1 * Math.sin(sunAnomaly * DEG) -
    1.274 * Math.sin((2 * elongation - moonAnomaly) * DEG) -
    0.658 * Math.sin(2 * elongation * DEG) -
    0.214 * Math.sin(2 * moonAnomaly * DEG) -
    0.11 * Math.sin(elongation * DEG);
  const illuminatedFraction = (1 + Math.cos(phaseAngle * DEG)) / 2;
  // Each named phase owns the eighth of the cycle centred on it, so "full moon"
  // covers the night either side of the exact moment rather than one instant
  // nobody dives.
  const eighth = Math.round((elongation / 360) * 8) % 8;
  return { phase: MOON_PHASES[eighth] as MoonPhase, illuminatedFraction };
}

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
  const place = { latitude, longitude };

  // Local noon of the departure's own day, which is the unambiguous anchor for
  // "which solar day": a 7:30 PM Florida departure is already tomorrow in UTC,
  // so anchoring on the instant itself would answer for the wrong day.
  const wall = utcToWallTime(input.startsAt, input.timeZone);
  const localNoon = wallTimeToUtc({ ...wall, hour: 12, minute: 0 }, input.timeZone);
  const dayNumber = Math.round(julianDay(localNoon) - J2000 + 0.0008);

  const sunsetAt = solarEventAt(dayNumber, place, SUNSET_ALTITUDE);
  if (!sunsetAt) return null;
  const endsAt = input.endsAt ?? null;
  const sameDayEnd =
    endsAt && endsAt.getTime() - input.startsAt.getTime() <= MS_PER_DAY ? endsAt : null;
  const stillOut = (sameDayEnd ?? input.startsAt).getTime();
  if (stillOut < sunsetAt.getTime()) return null;

  const { phase, illuminatedFraction } = moonAppearance(input.startsAt);
  return {
    sunsetAt,
    civilDuskAt: solarEventAt(dayNumber, place, CIVIL_DUSK_ALTITUDE),
    phase,
    illuminatedPercent: Math.round(illuminatedFraction * 100),
  };
}
