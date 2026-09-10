import { utcToWallTime, wallTimeToUtc } from "./zoned";

/**
 * **The almanac: where the sun and the moon are over one place on one day.**
 *
 * Sunrise, sunset, moonrise, moonset and the moon's phase, from a latitude, a
 * longitude, a date and a zone. No network call and no dependency — the
 * standard low-precision solar and lunar series, which land the solar events
 * inside a minute of a published table and the moon's rise and set inside a few
 * minutes, which is far more than a dive briefing needs.
 *
 * This file is the arithmetic. `src/lib/sky.ts` is the one composition that
 * cares only about a *night* departure and reads its solar events from here, so
 * the series is written once rather than twice.
 *
 * **It informs and gates nothing**, and it is prose-free like the rest of
 * `src/lib`: a moon phase leaves here as one of eight codes and becomes a word
 * in `src/i18n/sky-labels.ts`.
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

/** Where the shop, or the site, is — in signed degrees. */
export type SkyPlace = { latitude: number; longitude: number };

const DEG = Math.PI / 180;
const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;
/** Julian day of 2000-01-01 12:00 UT — the epoch every series below counts from. */
const J2000 = 2_451_545.0;
/** Julian day at the Unix epoch, so an instant converts with one multiply. */
const UNIX_EPOCH_JD = 2_440_587.5;
/** Earth's obliquity, degrees. */
const OBLIQUITY = 23.4397;
/**
 * The sun's altitude at the moment it "rises" or "sets": half a degree of solar
 * disc plus about 34 arcminutes of atmospheric refraction, which is the
 * convention every published sunrise table uses.
 */
export const SUN_HORIZON_ALTITUDE = -0.833;
/** Civil twilight ends when the sun's centre reaches six degrees below the horizon. */
export const CIVIL_TWILIGHT_ALTITUDE = -6;
/**
 * The moon's altitude at rise and set. Smaller than the sun's because the two
 * corrections pull opposite ways: refraction lifts the disc as it does the
 * sun's, and the moon's own parallax — it is close enough that an observer on
 * the surface sees it about a degree lower than a geocentric series says —
 * pushes back most of the way.
 */
const MOON_HORIZON_ALTITUDE = 0.133;

export function julianDay(instant: Date): number {
  return instant.getTime() / MS_PER_DAY + UNIX_EPOCH_JD;
}

function instantFromJulianDay(jd: number): Date {
  return new Date(Math.round((jd - UNIX_EPOCH_JD) * MS_PER_DAY));
}

/** Days since J2000, fractional — the argument every series below takes. */
function daysSinceEpoch(instant: Date): number {
  return julianDay(instant) - J2000;
}

/** Degrees folded into [0, 360). */
function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

/**
 * Which solar day a departure belongs to, as whole days from J2000.
 *
 * Anchored on **local noon**, which is the unambiguous answer: a 7:30 PM
 * Florida departure is already tomorrow in UTC, so anchoring on the instant
 * itself would compute the wrong day's sunset.
 */
export function solarDayNumber(at: Date, timeZone: string): number {
  const wall = utcToWallTime(at, timeZone);
  const localNoon = wallTimeToUtc({ ...wall, hour: 12, minute: 0 }, timeZone);
  return Math.round(daysSinceEpoch(localNoon) + 0.0008);
}

/** Midnight opening the departure's own local day, as an instant. */
function localMidnight(at: Date, timeZone: string): Date {
  const wall = utcToWallTime(at, timeZone);
  return wallTimeToUtc({ ...wall, hour: 0, minute: 0 }, timeZone);
}

/**
 * When the sun crosses `altitude` on each side of one solar day, for one
 * place, or null on the side it never reaches it — a polar summer where it
 * never sets, a polar winter where it never rises, or a white night where it
 * sets but never falls six degrees under. Null is a real answer: the caller
 * renders nothing rather than a fabricated time.
 *
 * The series is the standard one (the "sunrise equation" in its usual form):
 * mean solar time corrected for longitude, the sun's mean anomaly, the equation
 * of the centre, then the hour angle at the wanted altitude, subtracted from
 * transit for the morning crossing and added for the evening one.
 */
export function solarEventsOn(
  dayNumber: number,
  place: SkyPlace,
  altitude: number,
): { riseAt: Date | null; setAt: Date | null } {
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
  if (cosHourAngle < -1 || cosHourAngle > 1) return { riseAt: null, setAt: null };
  // The hour angle as a fraction of a turn, which is the unit the transit above
  // is measured in: one whole turn is one day of Julian date.
  const turn = Math.acos(cosHourAngle) / (2 * Math.PI);
  return {
    riseAt: instantFromJulianDay(transit - turn),
    setAt: instantFromJulianDay(transit + turn),
  };
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
  const centuries = daysSinceEpoch(at) / 36_525;
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

/**
 * How high the moon stands over one place at one instant, in degrees.
 *
 * Meeus' low-precision lunar position (mean longitude, mean anomaly, mean
 * distance, one term each for the ecliptic longitude and latitude), turned into
 * right ascension and declination through the obliquity, then into an altitude
 * through the local hour angle. Good to a few arcminutes, which moves a
 * moonrise by a minute or two.
 */
function moonAltitude(at: Date, place: SkyPlace): number {
  const days = daysSinceEpoch(at);
  const meanLongitude = normalizeDegrees(218.316 + 13.176396 * days);
  const meanAnomaly = normalizeDegrees(134.963 + 13.064993 * days);
  const meanDistance = normalizeDegrees(93.272 + 13.22935 * days);
  const eclipticLongitude = (meanLongitude + 6.289 * Math.sin(meanAnomaly * DEG)) * DEG;
  const eclipticLatitude = 5.128 * Math.sin(meanDistance * DEG) * DEG;
  const obliquity = OBLIQUITY * DEG;
  const rightAscension = Math.atan2(
    Math.sin(eclipticLongitude) * Math.cos(obliquity) -
      Math.tan(eclipticLatitude) * Math.sin(obliquity),
    Math.cos(eclipticLongitude),
  );
  const declination = Math.asin(
    Math.sin(eclipticLatitude) * Math.cos(obliquity) +
      Math.cos(eclipticLatitude) * Math.sin(obliquity) * Math.sin(eclipticLongitude),
  );
  // Greenwich mean sidereal time, then the observer's own meridian.
  const siderealTime = (280.16 + 360.9856235 * days + place.longitude) * DEG;
  const hourAngle = siderealTime - rightAscension;
  const latitude = place.latitude * DEG;
  return (
    Math.asin(
      Math.sin(latitude) * Math.sin(declination) +
        Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle),
    ) / DEG
  );
}

/**
 * When the moon comes up and goes down over one place, on one local day.
 *
 * There is no closed form the way there is for the sun: the moon's declination
 * moves by several degrees across a single day, so the hour angle it would be
 * solved from is not constant. The standard answer, and the one here, is to
 * walk the day two hours at a time and interpolate each crossing with the
 * parabola through the three sampled altitudes — which lands a rise inside a
 * minute or so and needs nothing but arithmetic.
 *
 * Either side can be null on its own: the moon rises about fifty minutes later
 * each day, so roughly one local day a month has a rise and no set, or the
 * reverse. At high latitude both can be null for days at a time. A null side is
 * a real answer and the caller says nothing rather than guessing.
 */
export function moonTimesOn(
  dayStart: Date,
  place: SkyPlace,
): { riseAt: Date | null; setAt: Date | null } {
  const altitudeAt = (hours: number) =>
    moonAltitude(new Date(dayStart.getTime() + hours * MS_PER_HOUR), place) - MOON_HORIZON_ALTITUDE;
  let riseHours: number | null = null;
  let setHours: number | null = null;
  let previous = altitudeAt(0);
  for (let hour = 1; hour <= 24; hour += 2) {
    const middle = altitudeAt(hour);
    const next = altitudeAt(hour + 1);
    // The parabola through (-1, previous), (0, middle), (1, next), in a frame
    // centred on the middle sample: its roots are the horizon crossings inside
    // this two-hour window.
    const a = (previous + next) / 2 - middle;
    const b = (next - previous) / 2;
    const vertex = -b / (2 * a);
    const vertexAltitude = (a * vertex + b) * vertex + middle;
    const discriminant = b * b - 4 * a * middle;
    let first = 0;
    let second = 0;
    let roots = 0;
    if (discriminant >= 0) {
      const spread = Math.sqrt(discriminant) / (Math.abs(a) * 2);
      first = vertex - spread;
      second = vertex + spread;
      if (Math.abs(first) <= 1) roots += 1;
      if (Math.abs(second) <= 1) roots += 1;
      // Only the later root fell inside the window; it is the crossing.
      if (first < -1) first = second;
    }
    if (roots === 1) {
      // One crossing: which way it went is decided by where the window began.
      if (previous < 0) riseHours ??= hour + first;
      else setHours ??= hour + first;
    } else if (roots === 2) {
      // Two crossings in two hours: the moon skimmed the horizon. A parabola
      // opening upwards (its vertex below the horizon) sets first and rises
      // second; one opening downwards does the reverse.
      riseHours ??= hour + (vertexAltitude < 0 ? second : first);
      setHours ??= hour + (vertexAltitude < 0 ? first : second);
    }
    if (riseHours !== null && setHours !== null) break;
    previous = next;
  }
  const instant = (hours: number | null) =>
    hours === null ? null : new Date(dayStart.getTime() + Math.round(hours * MS_PER_HOUR));
  return { riseAt: instant(riseHours), setAt: instant(setHours) };
}

/** Everything the almanac knows about one place on one local day. */
export type SunMoon = {
  /** When the sun comes up, or null where it does not on this day. */
  sunriseAt: Date | null;
  /** When it goes down, or null where it does not. */
  sunsetAt: Date | null;
  /** When the moon comes up on this local day, or null when it does not. */
  moonriseAt: Date | null;
  /** When it goes down on this local day, or null when it does not. */
  moonsetAt: Date | null;
  phase: MoonPhase;
  /** 0-100, rounded — what a diver reads, not what an almanac stores. */
  illuminatedPercent: number;
};

/**
 * The sun and the moon over one place on the local day `at` falls in, or null
 * when there is no place to compute from.
 *
 * Null in one case only, and it is the ordinary one: **no coordinates**. The
 * address form is optional and a whole timezone is far too coarse to derive a
 * sunrise from, so a shop that never set an address gets silence rather than a
 * guess. Everything else is answered per field, and a field the sky does not
 * supply on that day comes back null on its own.
 */
export function sunMoonFor(input: {
  /** Any instant inside the local day being asked about. */
  at: Date;
  /** The zone that fixes which local day that is — usually the shop's own. */
  timeZone: string;
  latitude: number | null;
  longitude: number | null;
}): SunMoon | null {
  const { latitude, longitude } = input;
  if (latitude === null || longitude === null) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const place = { latitude, longitude };
  const sun = solarEventsOn(solarDayNumber(input.at, input.timeZone), place, SUN_HORIZON_ALTITUDE);
  const moon = moonTimesOn(localMidnight(input.at, input.timeZone), place);
  const { phase, illuminatedFraction } = moonAppearance(input.at);
  return {
    sunriseAt: sun.riseAt,
    sunsetAt: sun.setAt,
    moonriseAt: moon.riseAt,
    moonsetAt: moon.setAt,
    phase,
    illuminatedPercent: Math.round(illuminatedFraction * 100),
  };
}
