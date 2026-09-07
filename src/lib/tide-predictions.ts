import type { CalendarDate } from "./calendar-date";
import { calendarDateToUtcMidnight, shiftCalendarDate } from "./calendar-date";
import { HOUR_MS, nowMs } from "./clock";
import type { TidePrediction } from "./tides";

/**
 * **NOAA CO-OPS tide predictions, behind the same seam as the marine forecast**
 * — ADR 20260907-noaa-tide-predictions.
 *
 * One provider, no key, one endpoint: the `predictions` product at `hilo`
 * interval, which is the high/low table a tide chart prints, in metres above
 * MLLW and in GMT so the instants need no zone arithmetic of their own. The
 * shape of the seam is `marine-forecast.ts`'s, deliberately: an injectable
 * fetcher for tests, a four-second bound, `DIVEDAY_DISABLE_EXTERNAL_HTTP`
 * honoured, and every failure answering `null` — no sentence rather than a
 * wrong one.
 *
 * Two things differ from the forecast. Predictions for a calendar day do not
 * change between renders, so the cache lives for hours rather than minutes and
 * the in-flight promise itself is cached, which is what "a page render never
 * fetches twice" means when three dives on one station render concurrently.
 * And with external HTTP disabled the seam answers a **fixture** rather than
 * nothing: the e2e fleet has no route out, the visual baseline needs the
 * sentence on screen, and a synthetic semidiurnal table derived from the date
 * is deterministic under the frozen clock. It is never served in production —
 * the flag is set only by `scripts/dev-server.mjs` and `playwright.config.ts`.
 */

type Fetcher = typeof fetch;

/** How many hours of predictions one request covers, from local midnight the day before. */
const PREDICTION_RANGE_HOURS = 72;
const PREDICTION_CACHE_TTL_MS = 12 * HOUR_MS;
const PREDICTION_CACHE_MAX_ENTRIES = 256;
/** How long a failed lookup is remembered, so an outage cannot be re-asked per render. */
const PREDICTION_FAILURE_TTL_MS = 60_000;
const PREDICTION_FETCH_TIMEOUT_MS = 4_000;

type CachedPredictions = { expiresAt: number; value: Promise<TidePrediction[] | null> };
const predictionCaches = new WeakMap<Fetcher, Map<string, CachedPredictions>>();

function cacheFor(fetcher: Fetcher) {
  const existing = predictionCaches.get(fetcher);
  if (existing) return existing;
  const created = new Map<string, CachedPredictions>();
  predictionCaches.set(fetcher, created);
  return created;
}

type PredictionsResponse = {
  predictions?: unknown;
  error?: unknown;
};

/**
 * NOAA writes `"2026-07-21 06:45"` with no zone marker; the request asked for
 * GMT, so that is what it is. A row that does not parse is dropped rather than
 * failing the day — one bad turn is not a reason to say nothing about the rest.
 */
function parsePrediction(row: unknown): TidePrediction | null {
  if (!row || typeof row !== "object") return null;
  const { t, v, type } = row as { t?: unknown; v?: unknown; type?: unknown };
  if (typeof t !== "string" || (type !== "H" && type !== "L")) return null;
  // Shape first: V8's legacy parser reads "garbage:00Z" as the year 2000 rather
  // than refusing it, so a malformed row would otherwise become a real turn.
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t)) return null;
  const at = new Date(`${t.replace(" ", "T")}:00Z`);
  if (!Number.isFinite(at.getTime())) return null;
  const height = typeof v === "string" ? Number.parseFloat(v) : typeof v === "number" ? v : NaN;
  return {
    at,
    kind: type === "H" ? "high" : "low",
    heightMeters: Number.isFinite(height) ? height : 0,
  };
}

export function parseTidePredictions(payload: unknown): TidePrediction[] | null {
  if (!payload || typeof payload !== "object") return null;
  const { predictions } = payload as PredictionsResponse;
  if (!Array.isArray(predictions)) return null;
  const parsed = predictions
    .map(parsePrediction)
    .filter((prediction): prediction is TidePrediction => prediction !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  return parsed.length > 0 ? parsed : null;
}

/** The request's `begin_date`: the local day *before*, so an early arrival still has a turn behind it. */
function beginDateFor(day: CalendarDate): CalendarDate {
  return shiftCalendarDate(day, -1);
}

function predictionsUrl(stationId: string, beginDate: CalendarDate) {
  const params = new URLSearchParams({
    product: "predictions",
    datum: "MLLW",
    station: stationId,
    interval: "hilo",
    units: "metric",
    time_zone: "gmt",
    format: "json",
    begin_date: beginDate.replaceAll("-", ""),
    range: String(PREDICTION_RANGE_HOURS),
  });
  return `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${params}`;
}

/**
 * A plausible semidiurnal table for the e2e fleet and an offline dev server:
 * two highs and two lows a day, 6 h 12.5 m apart, anchored so every run under
 * the frozen clock draws the same turns. Anchored to the *date* rather than to
 * the station, so two sites on one day read consistent water. Heights are the
 * Florida Keys' order of magnitude and are never compared to anything.
 */
export function fixtureTidePredictions(beginDate: CalendarDate): TidePrediction[] {
  const HALF_CYCLE_MS = (6 * 60 + 12.5) * 60_000;
  const start = calendarDateToUtcMidnight(beginDate).getTime() + 52 * 60_000;
  const turns: TidePrediction[] = [];
  const end = start + PREDICTION_RANGE_HOURS * HOUR_MS;
  for (let at = start, index = 0; at < end; at += HALF_CYCLE_MS, index++) {
    const low = index % 2 === 0;
    turns.push({ at: new Date(at), kind: low ? "low" : "high", heightMeters: low ? 0.1 : 0.7 });
  }
  return turns;
}

/**
 * The turns of the tide around one local day at one station, or `null`.
 *
 * `day` is the shop's own calendar date of the departure, so a boat that leaves
 * at 7 AM in Key Largo asks for the table that starts at the previous local
 * midnight and runs three days — enough for any dive on any leg, and for an
 * arrival just after midnight to still have the turn before it.
 */
export async function fetchTidePredictions(
  stationId: string,
  day: CalendarDate,
  fetcher: Fetcher = fetch,
): Promise<TidePrediction[] | null> {
  const beginDate = beginDateFor(day);
  // **Never in a real deployment, whatever the environment says.** Every other
  // consumer of this flag degrades to *off*; this one degrades to synthetic
  // turns that render byte-identically to real ones, against an ADR whose rule
  // for this feature is that the sentence must either be right or absent. The
  // flag is set only by `scripts/dev-server.mjs` and `playwright.config.ts`,
  // and that was the whole guarantee until this belt: a fact, not a check.
  //
  // The belt reads `DIVEDAY_E2E`, **not** `NODE_ENV`, because the e2e fleet
  // builds with `next build` and so *is* production by that measure. Guarding
  // on `NODE_ENV !== "production"` alone left this branch dead in the one
  // environment it exists to serve: the capture waited 210s for a sentence no
  // blocked fetch could ever produce, and the tide surface timed out on every
  // run. `playwright.config.ts` sets both flags together; `dev-server.mjs` sets
  // only the HTTP one, which the non-production arm still covers.
  const syntheticTurnsAllowed =
    process.env.DIVEDAY_E2E === "1" || process.env.NODE_ENV !== "production";
  if (
    syntheticTurnsAllowed &&
    process.env.DIVEDAY_DISABLE_EXTERNAL_HTTP === "1" &&
    fetcher === fetch
  ) {
    return fixtureTidePredictions(beginDate);
  }
  const cache = cacheFor(fetcher);
  const key = `${stationId}:${beginDate}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > nowMs()) return cached.value;
  cache.delete(key);

  const value = (async () => {
    try {
      const response = await fetcher(predictionsUrl(stationId, beginDate), {
        cache: "no-store",
        signal: AbortSignal.timeout(PREDICTION_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      return parseTidePredictions(await response.json());
    } catch {
      return null;
    }
  })();
  if (cache.size >= PREDICTION_CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { expiresAt: nowMs() + PREDICTION_CACHE_TTL_MS, value });
  const resolved = await value;
  // **A failure is remembered briefly rather than not at all.** Twelve hours
  // would lose the sentence for the rest of the day over one blip, which is
  // why this used to forget it outright — but forgetting it meant a provider
  // that was down cost a fresh four-second timeout per station per render, on
  // an unauthenticated page, for every visitor. A minute is short enough that
  // a blip costs one render and long enough that an outage costs one request
  // a minute per station. Guarded on identity so a newer entry for the same
  // key, or an eviction while this was in flight, is left alone.
  if (resolved === null && cache.get(key)?.value === value) {
    cache.set(key, { expiresAt: nowMs() + PREDICTION_FAILURE_TTL_MS, value });
  }
  return resolved;
}
