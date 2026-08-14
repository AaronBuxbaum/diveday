import { nowDate } from "./clock";
/** Open-Meteo supplies sea-surface temperature only ten days ahead. */
export const AUTOMATED_FORECAST_WINDOW_DAYS = 10;

const MILLISECONDS_PER_DAY = 86_400_000;

type ForecastPoint = { latitude: number; longitude: number };
type Fetcher = typeof fetch;

/**
 * The eight-point compass, as codes. Not "N"/"NE": those read as English
 * abbreviations but are not universal — Spanish writes O for west and SO/NO for
 * the two corners that touch it, so a hard-coded "W" is a wrong word, not a
 * neutral symbol. The bundle turns each code into the reader's own compass
 * (`src/i18n/unit-labels.ts`).
 */
export const CARDINAL_DIRECTIONS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
export type CardinalDirection = (typeof CARDINAL_DIRECTIONS)[number];

/**
 * What the marine model says the sea surface will be doing, in the units it is
 * published in. Numbers and codes only: the shop's own `depth_unit` decides
 * whether a crew reads 0.7 m or 2 ft, and that is a shop preference already on
 * `shops.depth_unit` — never a second setting of the forecast's own, and never
 * a sentence composed down here (DOM-L2, AGENTS.md — `src/lib` returns codes).
 */
export type AutomatedSurfaceConditions = {
  /**
   * **Significant wave height** — the mean of the highest third, which is what
   * every wave model behind Open-Meteo (ECMWF WAM, MFWAM, NOAA GFS-Wave)
   * publishes and what a marine forecast means by "seas". Individual sets run
   * roughly 1.5–2× this, so the copy says "2 ft seas" rather than "2 ft waves":
   * the second reads as a ceiling, and it is an average.
   */
  waveHeightMeters: number;
  waveDirection: CardinalDirection | null;
  wavePeriodSeconds: number | null;
};

/**
 * How the sea will *read* to a diver, as a code.
 *
 * The raw model output — "0.6 m seas from SE · 5 s period" — is three numbers
 * that mean something precise to a captain and nothing at all to the person
 * deciding whether to bring a seasickness tablet. Significant wave height is
 * itself a statistic (the mean of the highest third), a bearing on a diver's
 * booking page answers a question nobody asked, and a period in seconds is
 * meaningless without knowing what to compare it to. So the numbers stay in the
 * model and the page gets a reading.
 *
 * Ordered calmest to roughest, because the period adjustment below is a step
 * along this list.
 */
export const SEA_STATES = [
  "glassy",
  "calm",
  "light_chop",
  "choppy",
  "rough",
  "very_rough",
] as const;
export type SeaState = (typeof SEA_STATES)[number];

/**
 * Significant wave height (metres) at or above which each band starts, in the
 * same order as `SEA_STATES` minus its first entry — anything below the first
 * threshold is `glassy`.
 *
 * These are DiveDay's own working estimates for a recreational reef/wreck day,
 * not a standard and not a captain's numbers. Nobody who runs a boat has read
 * them. They are reasoned rather than sourced: the Douglas and WMO sea-state
 * scales exist, but they are coarse exactly where a dive day is decided (their
 * "smooth" band spans 0.1–0.5 m and their "slight" spans 0.5–1.25 m, which is
 * the whole range between a pleasant morning and a boat full of sick divers)
 * and they run to states no recreational trip sails in — so these split that
 * middle finely and collapse the top.
 *
 * What would move them is a working dive professional reading the six bands
 * against their own water and saying where the boundaries actually fall. Until
 * then, treat the numbers as a considered guess that has held up, not as fact.
 *
 * That reading is now a scheduled conversation rather than an open question in
 * the follow-up register: section C2 of the pilot first-call script
 * (`docs/product/pilot-kit/first-call-script.md`) carries the table and the
 * three questions to ask, for the calls H-31/H-32 are about. Answers land back
 * here, in the two period constants below, and in the boundary rows of
 * `marine-forecast.test.ts`.
 *
 * None of this is or may become a boarding gate. The reading informs a diver
 * planning their day; readiness and trip admission never read it, and the crew
 * make the go/no-go call at the dock.
 */
const SEA_STATE_THRESHOLDS_M: readonly number[] = [0.2, 0.5, 0.9, 1.5, 2.5];

/**
 * Wave *period* is what makes two seas of the same height feel different, so it
 * is the one correction applied to the height band.
 *
 * A short period is wind chop still being made by the wind that is on you now:
 * steep, close together, and slappy — the sea that makes a boat ride miserable
 * and a surface swim hard. A long period is swell that has travelled, arriving
 * as a slow rise and fall the boat rides over. Same height, one band apart in
 * how it reads.
 *
 * The two pivots and the size of the correction are estimates on the same
 * footing as the height bands above: the *direction* is uncontroversial, the
 * magnitude — a whole band, at 5 s and 9 s — is DiveDay's guess, unreviewed by
 * anyone who reads real water for a living. A dive professional's read is what
 * would change them. Like the bands, this only informs; it gates nothing.
 */
const SHORT_PERIOD_SECONDS = 5;
const LONG_PERIOD_SECONDS = 9;

/**
 * The plain reading of an automated sea forecast, or `null` when there is
 * nothing to read.
 *
 * Softening for a long period stops at `calm`, never `glassy`: a two-metre
 * groundswell rolling in every twelve seconds is a comfortable ride and is not
 * a mirror, and calling it one would be the forecast telling a diver something
 * they can disprove by looking at the water.
 */
export function seaStateReading(surface: AutomatedSurfaceConditions | null): SeaState | null {
  if (!surface) return null;
  const band = SEA_STATE_THRESHOLDS_M.filter(
    (threshold) => surface.waveHeightMeters >= threshold,
  ).length;
  const period = surface.wavePeriodSeconds;
  const adjusted =
    period === null
      ? band
      : period <= SHORT_PERIOD_SECONDS
        ? band + 1
        : period >= LONG_PERIOD_SECONDS
          ? Math.max(1, band - 1)
          : band;
  return SEA_STATES[Math.min(adjusted, SEA_STATES.length - 1)] ?? "calm";
}

export type AutomatedMarineForecast = {
  waterTemperatureC: number | null;
  surface: AutomatedSurfaceConditions | null;
  source: "Open-Meteo marine forecast";
  validAt: Date;
};

export type CrewPrediction = {
  conditionsSummary: string | null;
  waterTemperatureC: number | null;
  visibilityMeters: number | null;
  surfaceConditions: string | null;
};

export function hasCrewPrediction(prediction: CrewPrediction) {
  return Boolean(
    prediction.conditionsSummary ||
      prediction.waterTemperatureC !== null ||
      prediction.visibilityMeters !== null ||
      prediction.surfaceConditions,
  );
}

type MarineResponse = {
  hourly?: {
    time?: unknown;
    sea_surface_temperature?: unknown;
    wave_height?: unknown;
    wave_period?: unknown;
    wave_direction?: unknown;
  };
};

export function shouldShowAutomatedForecast(startsAt: Date, now = nowDate()) {
  const leadTime = startsAt.getTime() - now.getTime();
  return leadTime > 0 && leadTime <= AUTOMATED_FORECAST_WINDOW_DAYS * MILLISECONDS_PER_DAY;
}

function numberAt(values: unknown, index: number) {
  if (!Array.isArray(values)) return null;
  const value = values[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function closestForecastIndex(times: unknown, target: Date) {
  if (!Array.isArray(times) || times.length === 0) return null;
  let closestIndex: number | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const [index, time] of times.entries()) {
    if (typeof time !== "number" || !Number.isFinite(time)) continue;
    const distance = Math.abs(time * 1_000 - target.getTime());
    if (distance < closestDistance) {
      closestIndex = index;
      closestDistance = distance;
    }
  }
  return closestIndex;
}

/**
 * **Coming from, not going toward.** Open-Meteo documents this verbatim ("wave
 * directions are always reported as the direction the waves come from; 0° =
 * from north"), matching the oceanographic convention its upstream models use
 * — ECMWF's `mwd` and NOAA's `DIRPW` both say the same — and matching what a
 * crew says out loud on a dock. The *toward* convention exists, but it belongs
 * to current direction, not waves. Written down here because the word "from"
 * lives in an ICU template two modules away, which is how a future reader
 * "fixes" it to the wrong one (dive-domain-expert review, 2026-08-06).
 */
function cardinalDirection(degrees: number): CardinalDirection {
  const index = Math.round(degrees / 45);
  // `%` alone keeps the sign of a negative dividend, and Open-Meteo has been
  // seen returning a small negative bearing rather than clamping to [0, 360).
  const wrapped =
    ((index % CARDINAL_DIRECTIONS.length) + CARDINAL_DIRECTIONS.length) %
    CARDINAL_DIRECTIONS.length;
  return CARDINAL_DIRECTIONS[wrapped] ?? "n";
}

function surfaceConditions(
  waveHeight: number | null,
  wavePeriod: number | null,
  waveDirection: number | null,
): AutomatedSurfaceConditions | null {
  // Wave height is the reading that makes the other two mean anything: a period
  // and a bearing with no height describe the shape of a sea nobody can feel.
  if (waveHeight === null) return null;
  return {
    waveHeightMeters: waveHeight,
    waveDirection: waveDirection === null ? null : cardinalDirection(waveDirection),
    wavePeriodSeconds: wavePeriod === null ? null : Math.round(wavePeriod),
  };
}

/**
 * Returns a planning forecast without persisting it. A fresh request on each dynamic page render
 * keeps the automatic fallback separate from the crew's dated, published briefing.
 */
export async function fetchAutomatedMarineForecast(
  point: ForecastPoint,
  startsAt: Date,
  fetcher: Fetcher = fetch,
): Promise<AutomatedMarineForecast | null> {
  // Browser tests exercise our full Next/database stack, but must not wait on or depend on a
  // third-party forecast. Passing an explicit fetcher still exercises the adapter in unit tests.
  if (process.env.DIVEDAY_DISABLE_EXTERNAL_HTTP === "1" && fetcher === fetch) return null;

  const params = new URLSearchParams({
    latitude: String(point.latitude),
    longitude: String(point.longitude),
    hourly: "sea_surface_temperature,wave_height,wave_period,wave_direction",
    forecast_days: String(AUTOMATED_FORECAST_WINDOW_DAYS),
    timeformat: "unixtime",
  });

  try {
    const response = await fetcher(`https://marine-api.open-meteo.com/v1/marine?${params}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as MarineResponse;
    const hourly = payload.hourly;
    if (!hourly) return null;
    const index = closestForecastIndex(hourly.time, startsAt);
    if (index === null) return null;
    const unixTime = numberAt(hourly.time, index);
    if (unixTime === null) return null;

    const temperature = numberAt(hourly.sea_surface_temperature, index);
    const surface = surfaceConditions(
      numberAt(hourly.wave_height, index),
      numberAt(hourly.wave_period, index),
      numberAt(hourly.wave_direction, index),
    );
    if (temperature === null && surface === null) return null;

    return {
      waterTemperatureC: temperature === null ? null : Math.round(temperature),
      surface,
      source: "Open-Meteo marine forecast",
      validAt: new Date(unixTime * 1_000),
    };
  } catch {
    return null;
  }
}
