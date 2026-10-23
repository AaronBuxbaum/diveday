import { BASEMAP_TILE_HOSTS, VECTOR_LABEL_HOSTS } from "./basemap";
import { ARRIVAL_MAP_PROBES, MAP_REACHABILITY_PROBES } from "./maps";

/**
 * The app's Content-Security-Policy.
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
 * ## One enforced header
 *
 * {@link enforcedPolicy} is the whole policy, sent as `Content-Security-Policy`
 * (ADR 20260824-content-security-policy). It carries `report-uri`/`report-to`,
 * so a page it breaks produces a `security.csp_violation` line rather than
 * failing silently: a CSP that breaks Stripe's redirect or the offline
 * manifest's service worker in production, on a boat, is worse than no CSP.
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
 * A plain AWS region label, and nothing that could carry a space, a semicolon
 * or a second host into the header.
 */
const AWS_REGION = /^[a-z]{2}(-gov)?-[a-z]+-\d$/;

/**
 * Media image hosts: the S3 bucket the app writes to, and the CloudFront
 * distribution that fronts it. Wildcarded over the *bucket name* because this
 * header is built in the edge layer -- so it is a backstop, not the allowlist.
 * The allowlist that decides whether a URL may be *stored* is
 * `isManagedStorageUrl` (src/lib/storage/blob-host.ts), which compares against
 * the configured bucket and nothing else.
 *
 * The regional form is a **function of the region**, for the same reason
 * {@link rumConnectHosts} is: a CSP host source may wildcard only the leftmost
 * label. This list carried `https://*.s3.*.amazonaws.com` until 2026-09-02, and
 * Chromium had been dropping it on every page load with
 *
 *     The source list for the Content Security Policy directive 'img-src'
 *     contains an invalid source: 'https://*.s3.*.amazonaws.com'.
 *     It will be ignored.
 *
 * -- so a regional bucket URL (`<bucket>.s3.<region>.amazonaws.com`, which is
 * what `managedStorageOrigins` produces whenever `MEDIA_AWS_REGION` is set) was
 * admitted by nothing in this policy. Legacy global-endpoint URLs
 * (`<bucket>.s3.amazonaws.com`) matched the first entry and kept working, which
 * is why it went unnoticed: the two shapes differ by one label and only one of
 * them was covered.
 *
 * No region configured, no regional host -- a tighter policy rather than a
 * vaguer one, matching `rumConnectHosts`.
 */
const MEDIA_IMAGE_HOSTS = ["https://*.s3.amazonaws.com", "https://*.cloudfront.net"];

/**
 * The media origin the stack actually configured, when it is not one of the AWS
 * shapes above.
 *
 * `https://*.cloudfront.net` covers the distribution *only while the
 * distribution answers on the name AWS assigned it*. Point the distribution at
 * a domain DiveDay owns -- `mediaDomainName` in cdk.json, S11b of
 * `infra/lib/infra-stack.ts` -- and `MEDIA_PUBLIC_URL_BASE` becomes
 * `https://media.dive.day`, which matches nothing in this policy. Every course
 * photo, dive-site image, shop logo and recap picture would then be blocked:
 * a CSP failure that looks like a broken CDN and reads, in the console, like a
 * mistake in the alias.
 *
 * So the origin is read from the same variable the storage seam reads, rather
 * than pattern-matched. Same discipline as {@link mediaRegionalImageHosts} and
 * {@link rumConnectHosts}: a value interpolated into a header must not be able
 * to introduce a second source or a second directive, so anything that is not a
 * plain `https://host[:port]` origin contributes nothing at all.
 */
function mediaPublicImageHosts(publicUrlBase: string | null | undefined): string[] {
  const trimmed = publicUrlBase?.trim();
  if (!trimmed) return [];
  let origin: string;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return [];
    origin = url.origin;
  } catch {
    return [];
  }
  // **This line is load-bearing, not a belt to `URL.origin`'s brace.** The
  // tempting comment to write here is that an origin cannot contain whitespace,
  // a semicolon or a quote so the check is redundant -- and it is wrong about
  // the semicolon, which is the one character that would actually end this
  // source and start a second directive. WHATWG host parsing for a special
  // scheme runs IDNA with `UseSTD3ASCIIRules=false`, under which `;` is *not* a
  // forbidden domain code point: `new URL("https://a;b.com").origin` is
  // `https://a;b.com`, unescaped, and a policy carrying it would read
  // `img-src ... https://a;b.com`. This class is what refuses it. Do not delete
  // it as redundant.
  if (!/^https:\/\/[a-z0-9.\-:[\]]+$/i.test(origin)) return [];
  // Already covered by `MEDIA_IMAGE_HOSTS`' wildcard, so listing it again is
  // noise in a header that has a budget.
  //
  // Only the *global* bucket form is skipped alongside it, never the regional
  // one. `https://*.s3.amazonaws.com` matches exactly one leftmost label, so it
  // covers `<bucket>.s3.amazonaws.com` and does **not** cover
  // `<bucket>.s3.<region>.amazonaws.com` -- the lesson this module's own
  // docblock above records from issue #1263. The regional form is admitted only
  // by {@link mediaRegionalImageHosts}, which is conditional on a *different*
  // variable, so skipping it here would remove the one source that admits the
  // pre-verification bucket endpoint whenever `MEDIA_AWS_REGION` is absent or
  // malformed.
  const { hostname } = new URL(origin);
  if (/\.cloudfront\.net$/i.test(hostname)) return [];
  if (/^[^.]+\.s3\.amazonaws\.com$/i.test(hostname)) return [];
  return [origin];
}

/**
 * The regional virtual-hosted bucket form, one host per configured region.
 * Same validation as {@link rumConnectHosts}: anything but a plain AWS region
 * label is a misconfiguration, and a value interpolated into a header must
 * never be able to introduce a second source or a second directive.
 */
function mediaRegionalImageHosts(region: string | null | undefined): string[] {
  if (!region || !AWS_REGION.test(region)) return [];
  return [`https://*.s3.${region}.amazonaws.com`];
}

/**
 * The meeting point's map on `/ready` frames an OpenStreetMap export embed
 * (`src/lib/maps.ts`).
 */
const MAP_FRAME_HOSTS = ["https://www.openstreetmap.org"];

/**
 * The basemap's tile host, for every Leaflet map (ADR
 * 20261019-map-centric-dive-sites, `src/lib/basemap.ts`).
 */
const MAP_TILE_IMAGE_HOSTS: readonly string[] = BASEMAP_TILE_HOSTS;

/**
 * The images the route maps may read from a frame host: each probe URL itself,
 * path and all, so an injected `<img>` to any other path on those origins is
 * still a violation (#2441: one per host the embed needs).
 */
const MAP_PROBE_IMAGE_SOURCES: readonly string[] = [
  ...MAP_REACHABILITY_PROBES,
  ...ARRIVAL_MAP_PROBES,
];

/**
 * Sentry's ingest, as a belt to the tunnel's braces. `next.config.ts` sets
 * `tunnelRoute: "/monitoring"`, so the browser SDK posts same-origin and
 * `'self'` already covers it — but the tunnel is a build-time rewrite and a
 * misconfiguration would silently take error reporting with it, and an
 * enforced policy would then cause that failure rather than surface it.
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
const STRIPE_FORM_HOSTS = [
  "https://checkout.stripe.com",
  "https://connect.stripe.com",
  // The Customer Portal the billing actions redirect to. A Stripe custom domain
  // would not be listed here; its form hop is a client-side navigation once the
  // page hydrates.
  "https://billing.stripe.com",
];

/**
 * CloudWatch RUM's data plane and the Cognito identity pool it exchanges a
 * guest role through (`src/app/rum-client.tsx`). All three are per-region, and
 * a CSP host source may only wildcard the *leftmost* label —
 * `dataplane.rum.*.…` is not a legal source — so each region is substituted
 * from the public variable the SDK itself reads for that host. No RUM
 * configured, no hosts: a deployment without telemetry gets a tighter policy
 * rather than a vaguer one.
 *
 * The two halves read **different** variables because aws-rum-web does. The
 * data plane follows the region argument (`NEXT_PUBLIC_RUM_REGION`); Cognito
 * and STS are addressed at `identityPoolId.split(":")[0]` and nothing else
 * (`@aws-rum/web-core`'s `BasicAuthentication`). Both halves came from the
 * region variable until 2026-10-05, when a production page reported
 * `connect-src` against `cognito-identity.us-east-1` — the one host the SDK
 * picked by a rule this policy did not follow.
 */
function rumConnectHosts(
  region: string | null | undefined,
  identityPoolId: string | null | undefined,
): string[] {
  // Anything but a plain AWS region label is a misconfiguration, and a value
  // interpolated into a header must never be able to introduce a second source
  // or a second directive.
  const dataPlane =
    region && AWS_REGION.test(region) ? [`https://dataplane.rum.${region}.amazonaws.com`] : [];
  const poolRegion = identityPoolId?.split(":")[0];
  const credentials =
    poolRegion && AWS_REGION.test(poolRegion)
      ? [
          // The guest-credential exchange. `rum-client.tsx` passes *both* an
          // identity pool and a guest role, which selects aws-rum-web's
          // `BasicAuthentication` — Cognito `GetId` followed by STS
          // `AssumeRoleWithWebIdentity` — rather than the enhanced flow that
          // would stop at Cognito. Two hosts, not one.
          `https://cognito-identity.${poolRegion}.amazonaws.com`,
          `https://sts.${poolRegion}.amazonaws.com`,
        ]
      : [];
  return [...dataPlane, ...credentials];
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
   * `NEXT_PUBLIC_RUM_IDENTITY_POOL_ID`, or null when RUM is not configured.
   * Its `<region>:` prefix decides the Cognito and STS hosts, because that is
   * where the SDK sends them. See {@link rumConnectHosts}.
   */
  rumIdentityPoolId?: string | null;
  /**
   * `MEDIA_AWS_REGION`, or null when no media bucket is configured. Decides the
   * regional bucket host in {@link mediaRegionalImageHosts}; a wildcard cannot
   * stand in for it.
   */
  mediaRegion?: string | null;
  /**
   * `MEDIA_PUBLIC_URL_BASE`, or null when no media storage is configured. The
   * origin media URLs are actually written against, which stops being an AWS
   * hostname the moment the distribution answers on a domain we own. See
   * {@link mediaPublicImageHosts}.
   */
  mediaPublicUrlBase?: string | null;
  /**
   * True only on the shop's WhatsApp settings route, the one page that loads a
   * third-party script. See {@link META_SIGNUP_SCRIPT_HOST}.
   */
  metaSignup?: boolean;
  /**
   * True when `NEXT_PUBLIC_ARCGIS_API_KEY` is set, so the maps fetch Esri's
   * vector place labels ({@link VECTOR_LABEL_HOSTS}). Without a key no map
   * asks those hosts, and the policy does not name them.
   */
  vectorLabels?: boolean;
  /**
   * React uses `eval` in development to reconstruct server stacks in the
   * browser, and Next's own CSP guide says so. Automation test harnesses (E2E)
   * also evaluate scripts dynamically. Never true in production deployments.
   */
  development?: boolean;
};

function serialize(directives: (readonly [string, readonly string[]] | [string])[]): string {
  return directives
    .map((entry) => (entry.length === 1 ? entry[0] : `${entry[0]} ${entry[1].join(" ")}`))
    .join("; ");
}

const GOOGLE_FONTS_STYLESHEET_HOST = "https://fonts.googleapis.com";
const GOOGLE_FONTS_FILE_HOST = "https://fonts.gstatic.com";

/**
 * The policy, as sent in `Content-Security-Policy`.
 *
 * Carries `report-uri`/`report-to`, deliberately: this header can break a real
 * page, so its breakage must be audible. A blocked load is the thing the ADR's
 * "worse than no CSP" warning is about, and it must produce a
 * `security.csp_violation` line.
 */
export function enforcedPolicy(options: CspOptions): string {
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
    // A shop's chosen headline face loads from Google Fonts on its own
    // storefront (Harbor, ADR 20260901-diveday-reimagined): the stylesheet host
    // here, the font-file host under font-src, and nothing else of theirs.
    ["style-src", ["'self'", "'unsafe-inline'", GOOGLE_FONTS_STYLESHEET_HOST]],
    // `data:` for the inlined placeholders `next/image` emits, `blob:` for the
    // offline manifest's own cached photos.
    [
      "img-src",
      [
        "'self'",
        "data:",
        "blob:",
        ...MEDIA_IMAGE_HOSTS,
        ...mediaRegionalImageHosts(options.mediaRegion),
        ...mediaPublicImageHosts(options.mediaPublicUrlBase),
        // The one-pixel reads the route maps make before showing their frame
        // (`MAP_REACHABILITY_PROBES`, src/lib/maps.ts): frame hosts already.
        ...MAP_PROBE_IMAGE_SOURCES,
        ...MAP_TILE_IMAGE_HOSTS,
      ],
    ],
    ["font-src", ["'self'", GOOGLE_FONTS_FILE_HOST]],
    [
      "connect-src",
      [
        "'self'",
        VERCEL_INSIGHTS_HOST,
        ...SENTRY_INGEST_HOSTS,
        ...rumConnectHosts(options.rumRegion, options.rumIdentityPoolId),
        ...(options.metaSignup ? META_SIGNUP_CONNECT_HOSTS : []),
        ...(options.vectorLabels ? VECTOR_LABEL_HOSTS : []),
      ],
    ],
    // `'self'` for the staff embed generator's live preview
    // (settings/embed/EmbedGenerator.tsx), which frames this app's own
    // `?embed=1` page; `frame-src` does not fall back to `default-src`'s
    // `'self'` once it is set.
    [
      "frame-src",
      ["'self'", ...MAP_FRAME_HOSTS, ...(options.metaSignup ? META_SIGNUP_CONNECT_HOSTS : [])],
    ],
    // The offline-manifest service worker, and the blob workers Next may spawn.
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["media-src", ["'self'", "blob:"]],
    // Plugin-hosted script.
    ["object-src", ["'none'"]],
    // A `<base>` injection repoints every relative script URL on the page.
    ["base-uri", ["'self'"]],
    // Every form in this app posts to a Server Action on its own origin; the
    // Stripe hosts are there for the 303 that follows one. See
    // {@link STRIPE_FORM_HOSTS}.
    ["form-action", ["'self'", ...STRIPE_FORM_HOSTS]],
    // Clickjacking. Dropped only for the embed exception (`denyFraming`).
    ...(options.denyFraming ? ([["frame-ancestors", ["'none'"]]] as const) : []),
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
