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
 * Listed as bare **prefixes**, because a Next `source` matches a fixed number
 * of segments and this list needs to cover a variable one. `"/unsubscribe/:token"`
 * matches exactly one segment past the prefix, so the RFC 8058 one-click
 * endpoint a segment deeper — `src/app/unsubscribe/[token]/one-click/route.ts` —
 * matched no entry at all and fell back to the baseline policy. That route's
 * own doc comment explains it was nested under `/unsubscribe/[token]/`
 * *specifically* to stay covered by `CAPABILITY_ROUTE_PREFIXES`, which is true
 * of redaction (`redactCapabilityUrl` reads only `segments[0]`) and did not
 * carry over to here, where the matcher is stricter (issue #946).
 *
 * Nothing leaked: that endpoint answers a mail client with a null body, so no
 * document ever exists to issue a subresource request and no `Referer` is ever
 * sent regardless of policy. The defect was in the invariant, not in traffic.
 * `securityHeaderRules` now emits a bare and a `:rest*` source per prefix, so
 * **any** depth beneath a capability prefix inherits `no-referrer` and the next
 * nested route is covered without anyone noticing it needed to be.
 *
 * `src/lib/security-headers.test.ts` derives this list from the `[token]`
 * directories on disk, and now also descends *into* them: the previous walk
 * stopped at `[token]` and so was structurally unable to see the very route
 * that was missing. The comment here used to claim parity with
 * `CAPABILITY_ROUTE_PREFIXES` (`src/lib/capability-urls.ts`) — the two lists do
 * name the same prefixes, but only one of them was checked against the
 * filesystem, which is how they drifted at depth.
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
];

export function securityHeaderRules(): ConfigHeaderRule[] {
  return [
    { source: "/:path*", headers: BASELINE_SECURITY_HEADERS },
    // Two sources per prefix. The `:rest*` one covers anything nested beneath
    // the token segment, which is where the one-click unsubscribe endpoint was
    // hiding (issue #946).
    //
    // `*` is zero-or-more, so that source alone would in fact also match the
    // bare `/<prefix>/<token>` page; the explicit one beside it is redundant
    // rather than required, and is kept because a reader checking whether the
    // *page* is covered should not have to know that to answer yes. Redundant
    // in the safe direction — it can only ever add `no-referrer` to a path the
    // other source already matches (CodeRabbit review on PR #951 corrected an
    // earlier claim here that a single source was insufficient).
    ...TOKEN_ROUTE_PREFIXES.flatMap((prefix) => [
      `/${prefix}/:token`,
      `/${prefix}/:token/:rest*`,
    ]).map((source) => ({
      source,
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    })),
  ];
}
