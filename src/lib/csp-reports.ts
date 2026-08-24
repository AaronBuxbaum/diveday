import { z } from "zod";
import { redactCapabilityUrl } from "./capability-urls";

/**
 * Parsing for the two wire formats a browser posts a CSP violation in, and the
 * reduction of either to the four facts worth keeping.
 *
 * Kept out of the route so the shapes can be tested without a request: this is
 * the only place in the app that reads a body written by an *arbitrary*
 * browser on a page anyone can visit, and the interesting cases are all in the
 * parsing rather than in the HTTP.
 *
 * ## What is deliberately not kept
 *
 * `script-sample`, `source-file`, `line-number` and `column-number` are
 * dropped. They are the fields a violation report leaks through: `script-sample`
 * is the first 40 characters of the offending inline script, which on this app
 * would be a slice of the flight payload — a serialized render of whatever the
 * page was showing, up to and including a diver's name. The report exists to
 * say *which directive* a *which host* tripped, and those two survive.
 *
 * Both retained URLs are reduced to an origin (or a path, same-origin), never
 * carried whole: a `document-uri` on this app is routinely a capability URL
 * whose path segment **is** the bearer token (waivers, ready, recap, claim), and
 * a log group is exactly where one must not land
 * (docs/engineering/capability-telemetry-runbook.md).
 *
 * `/api/csp-report` is public and unauthenticated by necessity — the report
 * comes from a stranger's browser before anything has identified them — which
 * means every field here doubles as something a `curl` script can set to
 * anything it likes. `directive`, `blocked`'s keyword branch, and
 * `disposition` are each a small closed set in the CSP spec, so each is
 * normalized against that set rather than merely bounded: an unrecognized
 * value becomes `"unknown"`, never passed through. That is what keeps the
 * shape of a genuine browser report and a forged one apart on the pages a
 * dashboard groups by, security-review finding on issue #718.
 */

/** The classic `application/csp-report` body: `{"csp-report": {…}}`. */
const legacyReportSchema = z.object({
  "csp-report": z.object({
    "document-uri": z.string().optional(),
    "effective-directive": z.string().optional(),
    "violated-directive": z.string().optional(),
    "blocked-uri": z.string().optional(),
    disposition: z.string().optional(),
  }),
});

/** The Reporting API body: an array of `{type, body}` envelopes. */
const reportingApiSchema = z.array(
  z.object({
    type: z.string(),
    body: z
      .object({
        documentURL: z.string().optional(),
        effectiveDirective: z.string().optional(),
        blockedURL: z.string().optional(),
        disposition: z.string().optional(),
      })
      .optional(),
  }),
);

export type CspViolation = {
  /** The directive that would have blocked it, e.g. `connect-src`. */
  directive: string;
  /**
   * Where the blocked thing came from, as an origin — or one of the keywords a
   * browser sends in place of a URL (`inline`, `eval`, `data`, `blob`).
   */
  blocked: string;
  /** Which route the violating document was, with any capability segment gone. */
  route: string;
  /** `report` for the report-only header, `enforce` for the enforced one. */
  disposition: "enforce" | "report";
};

/** Keeps an unbounded field out of a log line and out of a dashboard's grouping. */
function bounded(value: string, max = 120): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

/**
 * Every directive this policy's own two builders can name
 * (`content-security-policy.ts`), plus the handful CSP3 defines that this app
 * does not currently emit but a future policy change might — `child-src`,
 * `script-src-elem`, `script-src-attr`, `style-src-elem`, `style-src-attr`,
 * `navigate-to`, `require-trusted-types-for`, `trusted-types`,
 * `upgrade-insecure-requests`, `sandbox`. A browser's `effective-directive`
 * only ever names one of these; an unrecognized value is a forged report
 * rather than a browser one.
 */
const KNOWN_DIRECTIVES = new Set([
  "default-src",
  "script-src",
  "script-src-elem",
  "script-src-attr",
  "style-src",
  "style-src-elem",
  "style-src-attr",
  "img-src",
  "font-src",
  "connect-src",
  "frame-src",
  "frame-ancestors",
  "worker-src",
  "manifest-src",
  "media-src",
  "object-src",
  "base-uri",
  "form-action",
  "child-src",
  "navigate-to",
  "require-trusted-types-for",
  "trusted-types",
  "upgrade-insecure-requests",
  "sandbox",
]);

/**
 * The keywords a browser sends in `blocked-uri` in place of a URL, per the CSP
 * spec's "special scheme" list — never anything else.
 */
const KNOWN_BLOCKED_KEYWORDS = new Set([
  "inline",
  "eval",
  "wasm-eval",
  "data",
  "blob",
  "filesystem",
  "about",
  "self",
]);

/** `report` unless the value is exactly the one other word this header carries. */
function normalizeDisposition(value: string | undefined): "enforce" | "report" {
  return value === "enforce" ? "enforce" : "report";
}

/** The directive name, or "unknown" for anything outside the CSP3 vocabulary. */
function normalizeDirective(value: string | undefined): string {
  if (!value) return "unknown";
  // `effective-directive` occasionally carries the whole source-list value
  // rather than the bare name (a real browser quirk on some old builds); take
  // only the first token before comparing.
  const name = value.trim().split(/\s+/, 1)[0] ?? "";
  return KNOWN_DIRECTIVES.has(name) ? name : "unknown";
}

/**
 * An origin for an absolute URL, the keyword itself for the handful a browser
 * sends instead (`inline`, `eval`, `data`, `blob`, …), and `unknown` for
 * anything else — including a non-URL value outside that closed set, which is
 * a forged report rather than a browser one. Never a path: a blocked URL can
 * carry a query string, and this endpoint is not a place to reconstruct one.
 */
export function blockedOrigin(value: string | undefined): string {
  if (!value) return "unknown";
  if (!value.includes("://")) {
    return KNOWN_BLOCKED_KEYWORDS.has(value) ? value : "unknown";
  }
  try {
    return new URL(value).origin;
  } catch {
    return "unknown";
  }
}

/**
 * The document's own path, through the same redaction every other telemetry
 * path in the app uses — a capability prefix collapses to `/<prefix>/[token]`.
 * The query string is dropped before redaction rather than after: it is never
 * useful for grouping violations, and dropping it removes a whole class of
 * thing that could have been in it.
 */
export function reportRoute(value: string | undefined): string {
  if (!value) return "unknown";
  try {
    // A same-origin report still arrives with an absolute `document-uri`.
    const path = value.includes("://") ? new URL(value).pathname : value.split("?")[0] || "/";
    return bounded(redactCapabilityUrl(path));
  } catch {
    return "unknown";
  }
}

/**
 * Every violation in one posted body, in either format. An unparseable body is
 * no violations rather than an error — the caller answers 204 to everything.
 */
export function parseCspReports(json: unknown): CspViolation[] {
  const legacy = legacyReportSchema.safeParse(json);
  if (legacy.success) {
    const body = legacy.data["csp-report"];
    return [
      {
        directive: normalizeDirective(body["effective-directive"] || body["violated-directive"]),
        blocked: blockedOrigin(body["blocked-uri"]),
        route: reportRoute(body["document-uri"]),
        disposition: normalizeDisposition(body.disposition),
      },
    ];
  }

  const modern = reportingApiSchema.safeParse(json);
  if (!modern.success) return [];
  return modern.data
    .filter((entry) => entry.type === "csp-violation" && entry.body)
    .map((entry) => ({
      directive: normalizeDirective(entry.body?.effectiveDirective),
      blocked: blockedOrigin(entry.body?.blockedURL),
      route: reportRoute(entry.body?.documentURL),
      disposition: normalizeDisposition(entry.body?.disposition),
    }));
}
