/**
 * Baseline security headers beyond the frame protection `src/proxy.ts` already
 * stamps (X-Frame-Options / CSP frame-ancestors, which stay there since they
 * must vary per-request on the embed exception — ADR 20260726-schedule-embed).
 * Wired into `next.config.ts`'s `headers()`, not the proxy, so they cover
 * every route including `/api` and static assets, which the proxy's matcher
 * deliberately excludes (specialist-optimization-audit-20260731.md §5).
 *
 * The rest of the Content-Security-Policy is **not** here, and that is the one
 * deliberate exception to the sentence above. It varies per request on two axes
 * a header rule cannot read — the embed exception (a query string) and the one
 * route that loads a third-party script (a path) — so it lives beside
 * `frame-ancestors` in `src/proxy.ts`, built by
 * `src/lib/content-security-policy.ts`. Two `Content-Security-Policy` headers
 * on one response are *intersected* rather than overridden, so splitting it
 * across both layers would produce a policy neither file states (ADR
 * 20260824-content-security-policy). This docblock used to end "A full
 * script/style-src CSP is a follow-up, not this pass" — that follow-up was
 * issue #718.
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
 * Bearer-token routes carry their capability in the URL path itself — a
 * `Referer` header leaking that URL to any third-party resource the page
 * ever references (an image, a font, an analytics beacon) hands over the
 * capability. `strict-origin-when-cross-origin` above still sends the full
 * URL to same-origin requests and the origin-only to cross-origin ones;
 * these routes get `no-referrer` instead, since even the origin-only case
 * has no legitimate cross-origin use here.
 *
 * One wildcard source per prefix covers both the token page and any routes
 * nested below it. The filesystem-derived tests verify every `[token]` route
 * remains covered, including descendants.
 */
export const TOKEN_ROUTE_PREFIXES = [
  "waivers",
  "ready",
  "recap",
  "verify",
  "reset-password",
  "invite",
  "unsubscribe",
  "calendar",
  // Added 2026-08-14: this list said it was in parity with
  // CAPABILITY_ROUTE_PREFIXES and had been missing `claim` since that route was
  // built, so `/claim/<token>` fell back to `strict-origin-when-cross-origin`
  // and handed the **full URL, token included**, to the next page as
  // `document.referrer`. A seat-claim token is identity takeover for that seat,
  // and any third-party script on the destination page reads the referrer by
  // default. Found by a security review of the advertising-tag rule.
  "claim",
  // The shop contact-email confirmation link (issue #1288): possession proves
  // the shop controls the address that becomes Reply-To, so the token must not
  // leave in a referrer either.
  "confirm-contact",
];

export function securityHeaderRules(): ConfigHeaderRule[] {
  return [
    { source: "/:path*", headers: BASELINE_SECURITY_HEADERS },
    // Next's `*` modifier allows zero or more segments, so the same source
    // covers the bare token page and any nested route.
    ...TOKEN_ROUTE_PREFIXES.map((prefix) => ({
      source: `/${prefix}/:token/:rest*`,
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    })),
  ];
}
