/** Open-Meteo supplies sea-surface temperature only ten days ahead. */
export const AUTOMATED_FORECAST_WINDOW_DAYS = 10;

const MILLISECONDS_PER_DAY = 86_400_000;

type ForecastPoint = { latitude: number; longitude: number };
type Fetcher = typeof fetch;

export type AutomatedMarineForecast = {
  waterTemperatureC: number | null;
  surfaceConditions: string | null;
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

export function shouldShowAutomatedForecast(startsAt: Date, now = new Date()) {
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

function cardinalDirection(degrees: number) {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(degrees / 45) % directions.length] ?? "N";
}

function surfaceConditions(
  waveHeight: number | null,
  wavePeriod: number | null,
  waveDirection: number | null,
) {
  if (waveHeight === null) return null;
  const direction = waveDirection === null ? "" : ` from ${cardinalDirection(waveDirection)}`;
  const period = wavePeriod === null ? "" : ` · ${Math.round(wavePeriod)} s period`;
  return `${waveHeight.toFixed(1)} m waves${direction}${period}`;
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
    const conditions = surfaceConditions(
      numberAt(hourly.wave_height, index),
      numberAt(hourly.wave_period, index),
      numberAt(hourly.wave_direction, index),
    );
    if (temperature === null && conditions === null) return null;

    return {
      waterTemperatureC: temperature === null ? null : Math.round(temperature),
      surfaceConditions: conditions,
      source: "Open-Meteo marine forecast",
      validAt: new Date(unixTime * 1_000),
    };
  } catch {
    return null;
  }
}
