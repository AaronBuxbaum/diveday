/**
 * Baseline security headers beyond the frame protection `src/proxy.ts` already
 * stamps (X-Frame-Options / CSP frame-ancestors, which stay there since they
 * must vary per-request on the embed exception — ADR 20260726-schedule-embed).
 * Wired into `next.config.ts`'s `headers()`, not the proxy, so they cover
 * every route including `/api` and static assets, which the proxy's matcher
 * deliberately excludes (specialist-optimization-audit-20260731.md §5). A
 * full script/style-src CSP is a follow-up, not this pass.
 */

export type ConfigHeader = { key: string; value: string };
export type ConfigHeaderRule = { source: string; headers: ConfigHeader[] };

const BASELINE_SECURITY_HEADERS: ConfigHeader[] = [
  // Force HTTPS for two years, including subdomains; safe to `preload` since
  // this app has no legitimate plain-HTTP surface.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Stop a browser from guessing a response's content-type — the one thing
  // that turns an uploaded file into an executed script.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Origin only on a cross-origin navigation, full URL same-origin. The
  // default (see below) is loosened for bearer-token pages, whose URL path
  // segment IS the capability (docs/engineering/capability-telemetry-runbook.md).
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing on this product needs any of these browser features.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

/**
 * Bearer-token pages carry their capability in the URL path itself — a
 * `Referer` header leaking that URL to any third-party resource the page
 * ever references (an image, a font, an analytics beacon) hands over the
 * capability. `strict-origin-when-cross-origin` above still sends the full
 * URL to same-origin requests and the origin-only to cross-origin ones;
 * these routes get `no-referrer` instead, since even the origin-only case
 * has no legitimate cross-origin use here. Kept in step with the
 * independent capability-route list `CAPABILITY_ROUTE_PREFIXES`
 * (`src/app/observability.ts`, the analytics-redaction seam) — both name
 * every bearer-token page for the same underlying reason, so a route added
 * to one belongs on the other too (security review finding on this task).
 */
const TOKEN_ROUTE_SOURCES = [
  "/waivers/:token",
  "/ready/:token",
  "/recap/:token",
  "/verify/:token",
  "/reset-password/:token",
  "/invite/:token",
  "/unsubscribe/:token",
  "/calendar/:token",
];

export function securityHeaderRules(): ConfigHeaderRule[] {
  return [
    { source: "/:path*", headers: BASELINE_SECURITY_HEADERS },
    ...TOKEN_ROUTE_SOURCES.map((source) => ({
      source,
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    })),
  ];
}
