/**
 * The app's Content-Security-Policy, in two halves.
 *
 * Until 2026-08-24 the entire CSP was `frame-ancestors 'none'` — clickjacking
 * protection and nothing else. No `default-src`, no `script-src`, no
 * `connect-src`, no `object-src`, no `base-uri`, no `form-action` (issue #718).
 *
 * It matters here rather than as a generic best practice because of what a
 * staff session can do: refund money on the shop's connected Stripe account,
 * export every diver's date of birth, emergency contact and waiver history, and
 * point a weekly backup at a bucket of its choosing. The app also renders
 * shop- and diver-authored free text nearly everywhere — dive-site briefings,
 * course prose, promo names, moderated reviews, roll-call notes. React escapes
 * all of it and that is the primary defence; this is the second one, the thing
 * that makes a future `dangerouslySetInnerHTML` a bug rather than a session
 * compromise.
 *
 * ## Two headers, deliberately
 *
 * {@link enforcedPolicy} carries only what has been *measured* not to break
 * anything, and every directive in it closes a real class on its own:
 * `object-src 'none'` (plugin-hosted script), `base-uri 'self'` (a `<base>`
 * injection repoints every relative script URL on the page), `form-action`
 * (form-hijack exfiltration), and the existing `frame-ancestors`.
 *
 * {@link reportOnlyPolicy} carries the full policy — the one to enforce next —
 * so a deployed environment reports what it would have blocked before anything
 * is actually blocked. That sequencing is the point: a CSP that breaks Stripe's
 * redirect or the offline manifest's service worker in production, on a boat,
 * is worse than no CSP.
 *
 * `frame-ancestors` is deliberately absent from the report-only half. CSP2
 * specifies it as ignored in a report-only policy, so including it buys nothing
 * and costs a console warning on every page load.
 *
 * ## Why `script-src` still carries `'unsafe-inline'`
 *
 * Measured, not assumed. One prerendered page of this app (`/`, from a real
 * `next build` + `next start`) emits **23 script tags, 22 of them inline**:
 * React's `$RB`/`$RV`/`$RC(...)` boundary runtime, a `requestAnimationFrame`
 * timing probe, `(self.__next_f=self.__next_f||[]).push(...)`, and two 50 KB
 * flight-payload pushes. All but the first vary with what the page rendered, so
 * a hash allowlist is structurally impossible.
 *
 * That leaves a nonce, and a nonce is incompatible with this app's whole
 * rendering model. Next's own guide is explicit — "you **must** use dynamic
 * rendering to add nonces", "Partial Prerendering (PPR) is incompatible with
 * nonce-based CSP since static shell scripts won't have access to the nonce"
 * (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
 * Every route in this app declares `export const instant = true` and the build
 * runs `cacheComponents: true`; the response for `/` carries
 * `x-nextjs-postponed: 1`, so PPR is live on it. Taking a nonce means giving up
 * the static shell on every route, which is ADR 20260804-instant-navigation and
 * the product's first principle.
 *
 * `experimental.sri` is not the escape hatch its docs imply either: SRI adds
 * `integrity` to *external* script tags and does nothing about the 22 inline
 * ones above.
 *
 * So `'unsafe-inline'` stays, and the value is in everything around it — an
 * injected `<script src="…">` pointing off-origin is still blocked, `eval` is
 * still blocked (no `'unsafe-eval'` outside development), and exfiltration is
 * bounded by `connect-src`, `img-src` and `form-action`. See ADR
 * 20260824-content-security-policy for the full reasoning and what would
 * reopen it.
 */

/** Where a violating browser posts its report. Same-origin, so no CORS. */
export const CSP_REPORT_PATH = "/api/csp-report";

/** The `Reporting-Endpoints` group name `report-to` below refers to. */
const REPORT_GROUP = "csp";

/**
 * Media image hosts: AWS S3 and CloudFront distributions, plus legacy Vercel Blob.
 */
const MEDIA_IMAGE_HOSTS = [
  "https://*.s3.amazonaws.com",
  "https://*.s3.*.amazonaws.com",
  "https://*.cloudfront.net",
  "https://*.public.blob.vercel-storage.com",
];

/**
 * The map `/ready`, the public trip page's dive briefing and the staff
 * dive-site editor all frame. `src/lib/maps.ts` builds every embed URL against
 * `maps.google.com` — and that host **302s to `www.google.com/maps/embed`**,
 * which a frame navigation re-checks against this directive. Listing only the
 * URL the app writes would therefore break all three surfaces at once while
 * looking correct in the source.
 */
const MAP_FRAME_HOSTS = ["https://maps.google.com", "https://www.google.com"];

/**
 * Sentry's ingest, as a belt to the tunnel's braces. `next.config.ts` sets
 * `tunnelRoute: "/monitoring"`, so the browser SDK posts same-origin and
 * `'self'` already covers it — but the tunnel is a build-time rewrite and a
 * misconfiguration would silently take error reporting with it, which is
 * exactly the failure a report-only pass exists to surface rather than to
 * cause.
 */
const SENTRY_INGEST_HOSTS = ["https://*.ingest.sentry.io", "https://*.ingest.us.sentry.io"];

/**
 * Vercel Analytics and Speed Insights. On Vercel both resolve to same-origin
 * `/_vercel/insights/script.js` and `/_vercel/speed-insights/script.js`, which
 * `'self'` already covers; off Vercel — a self-host, a preview elsewhere — the
 * SDKs fall back to this CDN for both the script and its beacon. Listed so the
 * policy does not quietly depend on where the app happens to be deployed.
 */
const VERCEL_INSIGHTS_HOST = "https://va.vercel-scripts.com";

/**
 * Meta's JavaScript SDK and the Embedded Signup flow it opens, for a shop
 * connecting its own WhatsApp sender (ADR 20260802-whatsapp-cloud-api-per-shop).
 * Scoped to that one settings route rather than granted app-wide: it is the only
 * third-party script this product loads at all, and it has no business being
 * loadable on the page where a diver pays.
 */
const META_SIGNUP_SCRIPT_HOST = "https://connect.facebook.net";
const META_SIGNUP_CONNECT_HOSTS = [
  "https://graph.facebook.com",
  "https://www.facebook.com",
  "https://web.facebook.com",
];

/**
 * Stripe's hosted pages, for `form-action` only.
 *
 * The browser never talks to Stripe directly — every Stripe call in this app is
 * a server-side `fetch` — so Stripe is deliberately absent from `connect-src`.
 * But paying from `/ready` and tipping from `/recap` are real `<form>` submits
 * to a Server Action that answers with a 303 to `checkout.stripe.com`, and
 * browsers have historically disagreed about whether `form-action` is
 * re-checked across that redirect. Getting it wrong kills a diver's payment at
 * the last click, silently; listing two known hosts costs nothing.
 */
const STRIPE_FORM_HOSTS = ["https://checkout.stripe.com", "https://connect.stripe.com"];

/**
 * CloudWatch RUM's data plane and the Cognito identity pool it exchanges a
 * guest role through (`src/app/rum-client.tsx`). Both are per-region, and a CSP
 * host source may only wildcard the *leftmost* label — `dataplane.rum.*.…` is
 * not a legal source — so the region is substituted from the same public
 * variable the client reads. No RUM configured, no hosts: a deployment without
 * telemetry gets a tighter policy rather than a vaguer one.
 */
function rumConnectHosts(region: string | null | undefined): string[] {
  // Anything but a plain AWS region label is a misconfiguration, and a value
  // interpolated into a header must never be able to introduce a second source
  // or a second directive.
  if (!region || !/^[a-z]{2}(-gov)?-[a-z]+-\d$/.test(region)) return [];
  return [
    `https://dataplane.rum.${region}.amazonaws.com`,
    // The guest-credential exchange. `rum-client.tsx` passes *both* an identity
    // pool and a guest role, which selects aws-rum-web's `BasicAuthentication`
    // — Cognito `GetId` followed by STS `AssumeRoleWithWebIdentity` — rather
    // than the enhanced flow that would stop at Cognito. Two hosts, not one.
    `https://cognito-identity.${region}.amazonaws.com`,
    `https://sts.${region}.amazonaws.com`,
  ];
}

export type CspOptions = {
  /**
   * False for the one deliberate framing exception — a shop embedding its own
   * booking calendar (ADR 20260726-schedule-embed). Everything else in the
   * policy is identical; only `frame-ancestors` is dropped.
   */
  denyFraming: boolean;
  /** `NEXT_PUBLIC_RUM_REGION`, or null when RUM is not configured. */
  rumRegion?: string | null;
  /**
   * True only on the shop's WhatsApp settings route, the one page that loads a
   * third-party script. See {@link META_SIGNUP_SCRIPT_HOST}.
   */
  metaSignup?: boolean;
  /**
   * React uses `eval` in development to reconstruct server stacks in the
   * browser, and Next's own CSP guide says so. Never true in production.
   */
  development?: boolean;
};

function serialize(directives: (readonly [string, readonly string[]] | [string])[]): string {
  return directives
    .map((entry) => (entry.length === 1 ? entry[0] : `${entry[0]} ${entry[1].join(" ")}`))
    .join("; ");
}

/**
 * The half that is enforced today: directives measured not to break anything,
 * each closing a class on its own. `frame-ancestors` is the pre-existing
 * clickjacking guard, unchanged in behaviour.
 *
 * Carries `report-uri`/`report-to` too, and that is deliberate rather than
 * copied from the report-only half by habit: this is the header that can
 * actually break a real page, so it is also the header whose breakage must be
 * audible. A report-only violation is a rehearsal; an enforced one is the
 * thing the ADR's "worse than no CSP" warning is about, and it must produce a
 * `security.csp_violation` line the same way.
 */
export function enforcedPolicy(options: CspOptions): string {
  return serialize([
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    // Every form in this app posts to a Server Action on its own origin; the
    // Stripe hosts are there for the 303 that follows one. See
    // {@link STRIPE_FORM_HOSTS}.
    ["form-action", ["'self'", ...STRIPE_FORM_HOSTS]],
    ...(options.denyFraming ? ([["frame-ancestors", ["'none'"]]] as const) : []),
    ["report-uri", [CSP_REPORT_PATH]],
    ["report-to", [REPORT_GROUP]],
  ]);
}

/**
 * The half that only reports: the policy to enforce once a deployed
 * environment has confirmed it blocks nothing real.
 */
export function reportOnlyPolicy(options: CspOptions): string {
  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    VERCEL_INSIGHTS_HOST,
    ...(options.metaSignup ? [META_SIGNUP_SCRIPT_HOST] : []),
    ...(options.development ? ["'unsafe-eval'"] : []),
  ];
  return serialize([
    ["default-src", ["'self'"]],
    // See the module docblock: 22 of this page's 23 script tags are inline and
    // most vary per render, so neither a hash nor a nonce is available without
    // giving up the static shell.
    ["script-src", scriptSrc],
    // Next inlines the critical CSS it extracts, and the app sets CSS custom
    // properties through `style=` in several places (the schedule board's
    // stagger delays, the route editor's overlay geometry).
    ["style-src", ["'self'", "'unsafe-inline'"]],
    // `data:` for the inlined placeholders `next/image` emits, `blob:` for the
    // offline manifest's own cached photos.
    ["img-src", ["'self'", "data:", "blob:", BLOB_IMAGE_HOST]],
    ["font-src", ["'self'"]],
    [
      "connect-src",
      [
        "'self'",
        VERCEL_INSIGHTS_HOST,
        ...SENTRY_INGEST_HOSTS,
        ...rumConnectHosts(options.rumRegion),
        ...(options.metaSignup ? META_SIGNUP_CONNECT_HOSTS : []),
      ],
    ],
    ["frame-src", [...MAP_FRAME_HOSTS, ...(options.metaSignup ? META_SIGNUP_CONNECT_HOSTS : [])]],
    // The offline-manifest service worker, and the blob workers Next may spawn.
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["media-src", ["'self'", "blob:"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'", ...STRIPE_FORM_HOSTS]],
    // `frame-ancestors` is omitted on purpose — CSP2 specifies it as ignored in
    // a report-only policy, so it would only produce a console warning.
    ["report-uri", [CSP_REPORT_PATH]],
    ["report-to", [REPORT_GROUP]],
  ]);
}

/**
 * The `Reporting-Endpoints` header naming the group `report-to` above points
 * at. `report-uri` is deprecated but is still the only mechanism Safari
 * implements, so both are sent.
 */
export function reportingEndpointsHeader(): string {
  return `${REPORT_GROUP}="${CSP_REPORT_PATH}"`;
}
