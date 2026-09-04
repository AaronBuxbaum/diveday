// Type-only, and that matters: `web-vitals-beacon.ts` imports the constants
// below, so a value import here would be a cycle — and worse, it would put zod
// back in every route's browser bundle, which is the whole reason the two files
// are separate. `import type` is erased at compile time, so neither happens.
import type { MutationDurationBeacon, WebVitalsBeacon } from "./web-vitals-beacon";

/**
 * Core Web Vitals as DiveDay measures them (ADR 20260806-cloudwatch-rum-and-vitals).
 *
 * This is the app's half of the Speed Insights equivalent: the browser reports
 * what it measured, `/api/vitals` turns it into one structured log line, and the
 * metric filters in `infra/lib/observability.ts` extract each figure as a
 * CloudWatch metric scored at **p75** — the same statistic Google and Vercel
 * use, because a median hides the quarter of visits that are actually bad.
 *
 * `field` is the key the figure takes in the log line, and it is a contract:
 * the metric filters read `$.lcp`, `$.inp`, `$.cls` and so on, and a filter
 * whose field no longer exists counts nothing forever without erroring.
 * `infra/lib/observability.test.ts` reads this array off disk and fails on
 * drift.
 *
 * The thresholds are Google's published Core Web Vitals boundaries, not
 * DiveDay's opinion — at or below `good` is good, above `poor` is poor, and the
 * band between them is "needs improvement". They are here rather than only in
 * the stack so a Logs Insights query and an alarm cannot disagree about what
 * "good" means.
 */
export const WEB_VITALS = [
  { name: "LCP", field: "lcp", good: 2_500, poor: 4_000, unit: "millisecond" },
  { name: "INP", field: "inp", good: 200, poor: 500, unit: "millisecond" },
  { name: "CLS", field: "cls", good: 0.1, poor: 0.25, unit: "score" },
  { name: "FCP", field: "fcp", good: 1_800, poor: 3_000, unit: "millisecond" },
  { name: "TTFB", field: "ttfb", good: 800, poor: 1_800, unit: "millisecond" },
] as const;

export type WebVitalName = (typeof WEB_VITALS)[number]["name"];
export type WebVitalRating = "good" | "needs_improvement" | "poor";

const byName = new Map(WEB_VITALS.map((vital) => [vital.name, vital]));

/** The five names the beacon accepts. Anything else is dropped, not stored. */
export const WEB_VITAL_NAMES = WEB_VITALS.map((vital) => vital.name) as [
  WebVitalName,
  ...WebVitalName[],
];

/**
 * Longest route a log line will carry. A real one is a fraction of this; the
 * cap is for the caller who supplies something else.
 */
const MAX_ROUTE_LENGTH = 512;

/**
 * Reduces a caller-supplied URL to the path and query this app would recognise,
 * before anything else looks at it.
 *
 * `redactCapabilityUrl` answers "is this a capability URL", and returns its
 * input untouched when it is not — which on a public endpoint means an
 * anonymous caller choosing 2,048 characters of whatever they like, including
 * an absolute URL pointing somewhere else entirely, to be written into
 * DiveDay's own log group and grouped on in a dashboard query. So the host,
 * scheme, credentials and fragment are dropped here and the remainder is
 * capped: a route is a path, and nothing a stranger sends can make it anything
 * else.
 *
 * Runs *before* the redaction, never after, so a capability prefix is still at
 * the front of the string when the redaction goes looking for it — and the cap
 * cannot truncate a path into something the redaction no longer recognises,
 * because the prefix is the first thing in it.
 */
export function normalizeBeaconPath(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl, "https://beacon.invalid");
  } catch {
    return "[unparseable]";
  }
  return `${url.pathname}${url.search}`.slice(0, MAX_ROUTE_LENGTH);
}

/** Google's bands. At the boundary counts as the better rating, per their definition. */
export function ratingFor(name: WebVitalName, value: number): WebVitalRating {
  const vital = byName.get(name);
  if (!vital) return "needs_improvement";
  if (value <= vital.good) return "good";
  return value > vital.poor ? "poor" : "needs_improvement";
}

/**
 * Flattens a beacon into the ids-and-numbers shape `log()` accepts.
 *
 * Deliberately one line per page view rather than one per metric: five lines
 * where one will do is five times the CloudWatch ingest for the same numbers,
 * and a metric filter reads a named field just as happily as a repeated one.
 * `route` is supplied by the caller because redacting a capability URL is the
 * route handler's job — `src/lib` may not reach into `src/app`, where that
 * redaction lives and is tested.
 *
 * A repeated metric name keeps the **last** value: the browser re-reports INP
 * and CLS as they get worse during a visit, and the final figure is the one
 * that describes the visit.
 */
export function webVitalsLogContext(
  beacon: WebVitalsBeacon,
  route: string,
): Record<string, string | number> {
  const context: Record<string, string | number> = { route };
  if (beacon.navigationType) context.navigationType = beacon.navigationType;
  for (const metric of beacon.metrics) {
    const vital = byName.get(metric.name);
    if (!vital) continue;
    // CLS is a fraction and needs its precision; the timings are milliseconds
    // and a fractional millisecond is noise in a p75.
    const value =
      vital.unit === "score"
        ? Math.round(metric.value * 10_000) / 10_000
        : Math.round(metric.value);
    context[vital.field] = value;
    context[`${vital.field}Rating`] = ratingFor(metric.name, metric.value);
  }
  return context;
}

/** Structured fields for the client mutation-duration metric filter. */
export function mutationDurationLogContext(
  mutation: MutationDurationBeacon["mutations"][number],
): Record<string, string | number> {
  return {
    action: mutation.action,
    // Millisecond precision below a tenth is noise in a network round trip and
    // makes a metric point harder to read without changing the p75 meaning.
    durationMs: Math.round(mutation.durationMs * 10) / 10,
  };
}
