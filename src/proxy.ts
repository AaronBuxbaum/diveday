import { getCookieCache, getSessionCookie } from "better-auth/cookies";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { publicRouteLookup } from "@/db/public-route-existence";
import { authSecret } from "@/lib/auth-secret";
import { isStaff, type Role } from "@/lib/authz";
import {
  BUDDY_COOKIE,
  BUDDY_COOKIE_MAX_AGE,
  BUDDY_COOKIE_PATH,
  buddyReferralFromSearchParams,
  encodeBuddyCookie,
} from "@/lib/buddy-links";
import { MINUTE_MS, nowMs } from "@/lib/clock";
import {
  type CspOptions,
  enforcedPolicy,
  reportingEndpointsHeader,
  reportOnlyPolicy,
} from "@/lib/content-security-policy";
import { classifyDatabaseFailure } from "@/lib/db-failure";
import {
  EMBED_BRAND_HEADER,
  EMBED_FONT_HEADER,
  EMBED_LOCALE_HEADER,
  EMBED_REQUEST_HEADER,
  isEmbeddableShopRoute,
  isEmbedWidgetRoute,
  isUnknownEmbedWidgetRoute,
  parseEmbedBrandParam,
  parseEmbedFontParam,
  REFUSED_SHOP_SLUG_HEADER,
  REQUEST_PATH_HEADER,
} from "@/lib/embed-routes";
import { log } from "@/lib/log";
import { type PublicRouteShape, publicRouteShape } from "@/lib/public-route-shape";
import { shopSlugFromPublicPath } from "@/lib/public-routes";
import {
  encodeReferralCookie,
  partnerFromSearchParams,
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_MAX_AGE,
  REFERRAL_COOKIE_PATH,
} from "@/lib/referrals";

const STAFF_PREFIX = "/shop";

/** `/shop/<slug>` exactly — the shop home, and nothing below it. */
const SHOP_HOME_PATH = /^\/shop\/[^/]+\/?$/;

/**
 * Query params the shop home used to answer to and no longer does.
 *
 * `?view=` selected the by-departure rendering of the one work queue, and
 * `?page=` paged it. The home is a single chronological spine now — today's
 * departures as stations in clock order (ADR
 * 20260827-clearwater-surface-language, decision 4) — so neither selects
 * anything, and a bookmark carrying one must land on the page rather than on a
 * URL that quietly means nothing.
 *
 * The strip happens **here**, at the edge, so it is a real 308 a bookmark
 * manager, a crawler and a `curl` all follow. Under `cacheComponents` a page
 * is partially prerendered, so a redirect thrown from a page body answers 200
 * with the hop resolving inside the streamed payload, which only a browser
 * follows (ADR 20260806-one-trip-create-form).
 */
const RETIRED_HOME_PARAMS = ["view", "page"] as const;

type CachedSessionSnapshot = {
  personId: string;
  shopId: string;
  shopSlug: string;
  roles: Role[];
};

/**
 * Route protection at the edge (Next 16 proxy convention; middleware is
 * deprecated). Server code re-checks via requireStaffSession() — this is
 * the outer layer, never the only one (ADR-0006), and better-auth's own docs
 * say so explicitly about `getSessionCookie`/`getCookieCache`: cookie-only
 * checks are for redirect convenience, not the security decision.
 *
 * `getSessionCookie` is the cheap, reliable signal — a plain cookie-presence
 * check with nothing to decode, so "no cookie" means "definitely not signed
 * in" with no false negatives. `getCookieCache` additionally decrypts the
 * cached session snapshot (personId/shopId/shopSlug/roles, mirroring what
 * next-auth's JWT used to carry) for the nice-to-have redirects below, but
 * that cache expires well before the underlying session does — a signed-in
 * staffer idle past the cache's `maxAge` will have a session cookie but no
 * readable cache. When that happens this function does **not** treat it as
 * "signed out": it lets the request through unmodified and leaves the call
 * to `requireStaffSession()` server-side, which always re-derives a fresh
 * session (and warms the cache back up for next time). Denying at the edge
 * is reserved for the one case that's actually unambiguous — no session
 * cookie at all.
 */
async function authGateResponse(req: NextRequest): Promise<Response | undefined> {
  const { pathname } = req.nextUrl;
  const hasSession = getSessionCookie(req) !== null;
  const cache = hasSession
    ? await getCookieCache(req, {
        secret: authSecret,
        strategy: "jwe",
        // Keep the edge reader aligned with buildAuth().advanced.useSecureCookies.
        // The e2e fleet deliberately uses unprefixed cookies over loopback HTTP;
        // Better Auth otherwise defaults this cache reader to the production
        // __Secure- name even though the session cookie itself accepts either.
        isSecure: process.env.DIVEDAY_E2E !== "1",
      }).catch(() => null)
    : null;
  const session = cache?.session as unknown as CachedSessionSnapshot | undefined;
  const roles = session?.roles;
  const shopSlug = session?.shopSlug;

  if ((pathname === STAFF_PREFIX || pathname === `${STAFF_PREFIX}/`) && roles && isStaff(roles)) {
    if (shopSlug) return NextResponse.redirect(new URL(`/shop/${shopSlug}`, req.nextUrl));
  }
  // Skipped for `?session=ended`: that param is only ever set by
  // `requireStaffSession()` (src/lib/session.ts) after a live database check
  // found the session stale — disabled, deleted, or demoted off every staff
  // role since it was minted. The cookie cache can still read `isStaff` for
  // up to its own maxAge (or the underlying session's full life, if the
  // cache is cold and this falls through elsewhere), so bouncing back to
  // `/shop/<slug>` unconditionally would send that request straight into
  // `requireStaffSession()` again, which would bounce it right back here —
  // an infinite redirect loop between the one layer that knows the account
  // is stale and the one that doesn't (issue #701).
  if (
    pathname === "/sign-in" &&
    roles &&
    isStaff(roles) &&
    shopSlug &&
    req.nextUrl.searchParams.get("session") !== "ended"
  ) {
    return NextResponse.redirect(new URL(`/shop/${shopSlug}`, req.nextUrl));
  }
  if (pathname.startsWith(STAFF_PREFIX)) {
    if (!hasSession) {
      // `callbackUrl` is what src/app/sign-in/page.tsx reads
      // (`shopSlugFromStaffUrl`) to offer a diver who followed a dead staff
      // link a way back to that shop's public schedule instead — carried
      // forward from next-auth's own denial redirect, which set the same
      // parameter automatically.
      const signIn = new URL("/sign-in", req.nextUrl);
      signIn.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(signIn);
    }
    if (roles && !isStaff(roles)) return NextResponse.redirect(new URL("/", req.nextUrl));
    // After the auth gate, never before it: a signed-out visitor with a stale
    // `?view=` bookmark belongs at sign-in, not at a tidied URL.
    if (
      SHOP_HOME_PATH.test(pathname) &&
      RETIRED_HOME_PARAMS.some((param) => req.nextUrl.searchParams.has(param))
    ) {
      const url = new URL(req.nextUrl);
      for (const param of RETIRED_HOME_PARAMS) url.searchParams.delete(param);
      // **Absolute, and built from `req.nextUrl` — both halves matter.**
      //
      // The `/blockers` Route Handler answers with a *relative* `Location`
      // because a Route Handler's response goes to the client as written. A
      // proxy response does not: Next's middleware adapter parses the header
      // through `NextURL` before it ever reaches the wire, and a relative
      // value there has no base to resolve against — it throws `Invalid URL`
      // and the request answers **500**, which is exactly what it did until
      // `day-spine.spec.ts` asked for the status.
      //
      // Deriving the URL from `req.nextUrl` is what keeps the host honest:
      // it is the request's own origin, so the hop cannot pin a visitor to
      // whichever host the proxy happened to resolve — the trap that once
      // sent an owner cookied to `127.0.0.1` to `localhost` and out to
      // /sign-in. Every other redirect in this file is built the same way.
      return NextResponse.redirect(url, 308);
    }
  }
  return undefined;
}

/**
 * Stamp the `x-middleware-request-*` / `x-middleware-override-headers` pair
 * onto `res` — the wire protocol `NextResponse.next({request:{headers}})`
 * itself compiles down to (see node_modules/next/dist/server/web/
 * spec-extension/response.js `handleMiddlewareField`). Next's dev router
 * (server/lib/router-utils/resolve-routes.js) treats `x-middleware-override-
 * headers` as the *complete* set of request headers that survive — every
 * header on the original request that isn't named in that list gets deleted
 * before the request continues. So the list must always be seeded from the
 * full original request headers (here, `req`), never built up from scratch
 * with only the one header this function means to add/change — that
 * previously dropped `cookie` (and everything else) off every request that
 * passed through this proxy, signing every visitor back out on their very
 * next navigation.
 *
 * Takes every override in one call for the same reason: each call rewrites
 * `x-middleware-override-headers` in full from `req.headers`, so a second call
 * would silently drop the first call's header back off the surviving set.
 */
function overrideRequestHeaders(
  req: NextRequest,
  res: Response,
  overrides: Record<string, string>,
): void {
  const requestHeaders = new Headers(req.headers);
  for (const [name, value] of Object.entries(overrides)) requestHeaders.set(name, value);
  for (const [key, headerValue] of requestHeaders) {
    res.headers.set(`x-middleware-request-${key}`, headerValue);
  }
  res.headers.set("x-middleware-override-headers", [...requestHeaders.keys()].join(","));
}

/** `/shop/<slug>/settings/whatsapp`, the one route that loads Meta's SDK. */
const WHATSAPP_SETTINGS_PATH = /^\/shop\/[^/]+\/settings\/whatsapp(\/|$)/;

/**
 * Remember which partner sent this visitor, for the booking they may make on a
 * different page a few clicks later.
 *
 * Written here rather than on the storefront page because a Server Component
 * cannot set a cookie, and a client-side `document.cookie` would put a value
 * the database reads inside the diver's own reach. The edge sees the partner
 * link itself, which is the only place the fact exists.
 *
 * Three properties, each from a way this was found to be wrong (security review
 * of issue #1285):
 *
 * **Only on a real top-level navigation.** `SameSite` governs whether a stored
 * cookie is *attached to outgoing requests*; it places no restriction at all on
 * a `Set-Cookie` in the response to a cross-site subresource request, so
 * `<img src="https://dive.day/s/x?utm_source=partner&utm_campaign=rival">` on
 * any page silently plants an attribution on every visitor that page has, and
 * `X-Frame-Options` refuses an iframe only after the response and its headers
 * were processed. If a shop pays commission off this ledger, that is unearned
 * money at the scale of the attacker's ad impressions. `Sec-Fetch-Dest`/`-Mode`
 * are browser-set and unforgeable by page script; a request that does not say
 * it is a document navigation mints nothing.
 *
 * **The shop is in the value.** One cookie covers the whole `/s/` namespace,
 * so it travels to every shop's storefront; `encodeReferralCookie` binds it to
 * the shop whose link minted it and the booking action refuses anything else.
 *
 * **The response is not cacheable.** The value is a pure function of this
 * request's URL, which makes a replay harmless *only* while every shared cache
 * in front of the app keys on the query string — and stripping `utm_*` from a
 * cache key is a common hit-rate optimisation. `private, no-store` on the one
 * response that carries the cookie removes the assumption rather than
 * documenting it.
 *
 * `HttpOnly` so the booking action's reading of it cannot be steered from the
 * page, and scoped to `/s/` so it is never sent up with a staff request.
 * `Secure` except under the e2e fleet, which deliberately runs over loopback
 * HTTP and would otherwise drop it — the same env-based answer `authGateResponse`
 * gives the same question, rather than a second one derived from the URL.
 */
/**
 * **The buddy seat** (ADR 20260908-one-hand, decision 6, lever W): remember
 * which diver's recap link this visitor arrived on.
 *
 * Every guard `rememberPartnerReferral` below applies, applies here, and for
 * the same reasons: a document navigation only, so an `<img>` on a hostile page
 * mints nothing; the shop bound into the value, because one cookie covers the
 * whole `/s/` namespace; `private, no-store` on the response that carries it;
 * `HttpOnly` and `/s/`-scoped.
 *
 * One difference, and it is in the value rather than the mechanism: this id is
 * signed, so an unverifiable `?via=` sets no cookie at all
 * (`buddyReferralFromSearchParams`). A partner slug is free text a shop typed;
 * this one names a booking, and a value that names a booking has to prove it
 * came from us.
 */
function rememberBuddyReferral(req: NextRequest, res: Response): void {
  if (!(res instanceof NextResponse)) return;
  const shopSlug = shopSlugFromPublicPath(req.nextUrl.pathname);
  if (!shopSlug) return;
  if (req.headers.get("sec-fetch-dest") !== "document") return;
  if (req.headers.get("sec-fetch-mode") !== "navigate") return;
  const referralId = buddyReferralFromSearchParams(req.nextUrl.searchParams);
  if (!referralId) return;
  res.cookies.set(BUDDY_COOKIE, encodeBuddyCookie(shopSlug, referralId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.DIVEDAY_E2E !== "1",
    path: BUDDY_COOKIE_PATH,
    maxAge: BUDDY_COOKIE_MAX_AGE,
  });
  res.headers.set("Cache-Control", "private, no-store");
}

function rememberPartnerReferral(req: NextRequest, res: Response): void {
  // `.cookies` is a NextResponse affordance; a `Response` from elsewhere has
  // no way to set one.
  if (!(res instanceof NextResponse)) return;
  // Only on the storefront a partner link actually points at, and only for a
  // slug that is shaped like one: `shopSlugFromPublicPath` holds it to
  // `SHOP_SLUG_PATTERN` rather than taking whatever the URL's second segment
  // says.
  const shopSlug = shopSlugFromPublicPath(req.nextUrl.pathname);
  if (!shopSlug) return;
  // A document navigation, never a subresource — see above. An absent header is
  // an old browser or a non-browser client, and mints nothing either way.
  if (req.headers.get("sec-fetch-dest") !== "document") return;
  if (req.headers.get("sec-fetch-mode") !== "navigate") return;
  const partner = partnerFromSearchParams(req.nextUrl.searchParams);
  if (!partner) return;
  res.cookies.set(REFERRAL_COOKIE, encodeReferralCookie(shopSlug, partner), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.DIVEDAY_E2E !== "1",
    path: REFERRAL_COOKIE_PATH,
    maxAge: REFERRAL_COOKIE_MAX_AGE,
  });
  res.headers.set("Cache-Control", "private, no-store");
}

/**
 * Next's own not-found entry, as `next/dist/shared/lib/entry-constants.js`
 * spells it (`UNDERSCORE_NOT_FOUND_ROUTE`). Written out rather than imported:
 * a deep import into the framework's internals to save retyping eleven
 * characters buys a break on the next minor. The value is what makes this work
 * — `base-server.js` rewrites the pathname to `/404` and sets
 * `res.statusCode = 404` *before* rendering, so the status of this response
 * does not depend on streaming at all, which is the entire point.
 */
const NOT_FOUND_ROUTE = "/_not-found";

/** One refused-statement line per failure kind, per instance, per minute. */
const REFUSED_QUERY_REPORT_INTERVAL_MS = MINUTE_MS;

/**
 * How many distinct `shape:code` pairs get a bucket of their own before the
 * rest share one. The key is built from two closed vocabularies, so a caller
 * cannot mint keys — but this is the map a flood writes into, so it is bounded
 * anyway rather than trusted to stay small.
 */
const REFUSED_QUERY_KIND_LIMIT = 16;

/** Where pairs past the limit are counted, so the map cannot be grown. */
const REFUSED_QUERY_OVERFLOW = "overflow";

/** Module state, so the bound is per instance and dies with the instance. */
const refusedQueries = new Map<string, { lastReportedAt: number; swallowed: number }>();

/**
 * The refused-statement line, bounded — the damper shape `reportStoreFailure`
 * in `src/lib/rate-limit.ts` already uses.
 *
 * **Why this branch and not its neighbour.** A stranger reaches this one at
 * will: the slugs below go to Postgres unfiltered and length-unbounded on
 * purpose, so `/s/%00` is a statement the server refuses, once per request,
 * for as long as it is sent. An anonymous GET should not be able to make the
 * app write without limit. The `error` branch is deliberately left undamped:
 * `DatabaseUnavailable` alarms at one datapoint in five minutes
 * (`infra/lib/observability.ts`), and delaying it would blunt the one line
 * here worth waking somebody for — which is the whole reason
 * `classifyDatabaseFailure` splits the two. That does leave the *error* branch
 * unbounded by request rate: pool exhaustion under a flood throws without a
 * `code`, classifies as unreachable, and writes a line per request. That is a
 * genuine incident and should page somebody, so it is not damped here; the
 * fleet-wide answer to the flood itself is a platform rate rule.
 *
 * **Bucketed per `shape:code`, not globally.** A single bucket would let
 * whoever is sending `/s/%00` hold it open and fold every *other* refused-class
 * failure into `swallowed`, unreported — a stranger choosing what an operator
 * can see. That matters because the refused class is wider than the caller's
 * own bytes: `28P01` (our credentials rejected), `42501` (a revoked grant) and
 * `42P01` (a table missing mid-deploy) all classify here today, and each takes
 * the whole existence check back to fail-open soft 404s. Keyed per kind, a code
 * a caller cannot produce always gets its own first line. The key is built from
 * two closed vocabularies and the map is capped regardless, so the bucket count
 * is bounded whatever arrives.
 *
 * **The bound is per instance, not fleet-wide.** Serverless instances are many
 * and short-lived, so a flood spread across them still writes a line each.
 * This damps one instance's chatter; it is not a rate limit, and the
 * fleet-wide answer to a flood is a platform rule
 * (docs/engineering/rate-limiting-runbook.md).
 *
 * **Priced once, here, so nobody re-derives it.** The line is about 126 bytes,
 * roughly 152 with CloudWatch's per-event overhead, so on the order of 35M
 * such requests a month still sit inside the 5 GB always-free allowance. Each
 * of those requests already costs a Vercel invocation and a Neon read, and the
 * `vercel_spend` and `neon_compute` ceilings in `src/lib/cost-guardrails.ts`
 * meet that long first. The bound exists because an unbounded
 * attacker-triggered write is the wrong shape, not because the bill was large.
 *
 * `swallowed` keeps the real rate visible through the damping, the same as
 * `rate_limit.store_failed`.
 */
function reportRefusedQuery(shape: PublicRouteShape["kind"], code: string, now: number): void {
  try {
    const kind = `${shape}:${code}`;
    const key =
      refusedQueries.has(kind) || refusedQueries.size < REFUSED_QUERY_KIND_LIMIT
        ? kind
        : REFUSED_QUERY_OVERFLOW;
    let bucket = refusedQueries.get(key);
    if (!bucket) {
      bucket = { lastReportedAt: Number.NEGATIVE_INFINITY, swallowed: 0 };
      refusedQueries.set(key, bucket);
    }
    bucket.swallowed += 1;
    const sinceLastReport = now - bucket.lastReportedAt;
    // A `now` that moved backwards reports rather than silently suppressing
    // until the clock catches up again.
    if (sinceLastReport >= 0 && sinceLastReport < REFUSED_QUERY_REPORT_INTERVAL_MS) return;
    const swallowed = bucket.swallowed;
    bucket.swallowed = 0;
    bucket.lastReportedAt = now;
    log("public_route.existence_query_refused", "warn", { shape, code, swallowed });
  } catch {
    // The precedent's rule, and the reason it wraps its whole body:
    // observability failing must never become the outage the fail-open policy
    // exists to prevent. A throw out of here would escape this function's
    // caller's `catch` and turn a database hiccup into a 500 on every public
    // page.
  }
}

/**
 * **A `/s/**` URL that names nothing is refused here, above the streaming
 * boundary** (ADR 20260912-the-public-namespace-refuses-at-the-edge).
 *
 * Under `cacheComponents` every page in the public namespace streams a static
 * shell first, so the `notFound()` in its body arrives long after a 200 went
 * out on the wire: a dead booking link, a course a shop deleted, a mistyped
 * shop slug all answered 200 with a not-found page in the body, and a crawler
 * read that as a page worth keeping. `generateMetadata` cannot fix it either —
 * metadata that reads `params` defers to request time and streams in with the
 * rest. The only layer left is this one, and the embed catalogue above has been
 * proving it works for one route since before this one generalised it.
 *
 * **What it costs.** One indexed read on `shops.slug` for a shop-level URL or
 * an unmintable segment under one, two for a URL that names a course, a dive
 * site or a departure inside a shop —
 * paid on the request path by every diver on every public page, which is
 * exactly the latency ADR 20260804-instant-navigation set out to avoid. It is
 * the same read the page itself is about to do a few milliseconds later, so
 * the *work* is duplicated rather than new; the TTFB is not. If that proves to
 * matter, the fix is a process-local cache of **positive** shop-slug results
 * with a short TTL and never a negative one — a shop created a second ago must
 * not 404 — and it should be measured before it is written.
 *
 * **What happens when the read fails or hangs.** A throw is not a refusal:
 * `catch` returns `null` and the request continues exactly as it does today,
 * because a 404 fired by a database outage would take every live shop off the
 * internet to fix a soft 404 on dead links. There is deliberately no timeout
 * racing this read — the page's own render issues the same query immediately
 * afterwards, so a slow database is slow either way and a race would only buy
 * a 200 whose body then hangs.
 *
 * GET and HEAD only. A Server Action posts to the route it sits on, and a
 * booking that lands on a refusal instead of the page is a lost sale.
 *
 * **`null` is "serve the page"; an object is "refuse it".** The object carries
 * the one thing `/_not-found` cannot work out for itself — whether the shop
 * the URL named is really there — because issue #765 says a diver whose link
 * died is owed that shop's own refusal and *not* a button to a schedule that
 * would 404 in its turn. It costs no read of its own: the lookup opens by
 * resolving the shop slug either way, so it hands both answers back together.
 * This used to ask a second time, which made a dead URL the most expensive
 * request in the public namespace — three reads, unauthenticated, for a path
 * nobody legitimate requests.
 */
async function refusedPublicRoute(
  req: NextRequest,
): Promise<{ liveShopSlug: string | null } | null> {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const shape = publicRouteShape(req.nextUrl.pathname);
  if (!shape) return null;
  try {
    const db = await getDb();
    const { exists, shopExists } = await publicRouteLookup(db, shape);
    if (exists) return null;
    // The slug the refusal is framed by is the one `shape` carries — the same
    // string the lookup just resolved — and no longer a second parse of the
    // pathname. That parse decoded nothing and held the segment to a charset
    // narrower than what sign-up mints, so a live `blue--mantis` and a live
    // shop reached as `/s/blue%2Dmantis` were framed as DiveDay's sales 404
    // instead of their own (issue #765). `malformed` carries its shop for this
    // reason: a well-formed shop with a segment no shop could have minted is
    // exactly the case that should still be framed as that shop's. A refused
    // `shop` shape *is* the missing shop, and `shopExists` is false there
    // without a branch here saying so.
    return { liveShopSlug: shopExists ? shape.shopSlug : null };
  } catch (error) {
    // Two unrelated failures land here and only one of them is an incident.
    // The slugs above reach Postgres unfiltered and length-unbounded on
    // purpose, so `/s/%00` is a statement the server refuses — once per
    // request, for as long as it is sent, and free for whoever is sending it.
    // The database being gone is the other one, and it stops this check for
    // every diver at once: that is the line worth an alarm, and it has one
    // (`DatabaseUnavailable` in `infra/lib/observability.ts`).
    //
    // Neither branch logs the caught message or the pathname. Drizzle's
    // wrapper message is the SQL followed by the bound parameters verbatim,
    // which is the attacker's own string, and so was the `path` this used to
    // ship to CloudWatch unauthenticated — and, until `reportRefusedQuery`
    // above, once per request for as long as it was sent. `shape.kind` says
    // which lookup failed out of a closed set of five, and
    // `classifyDatabaseFailure` reports a SQLSTATE, a Node errno, or
    // `"unknown"` — closed vocabularies, never a string off the wire.
    //
    // Both codes are written out as literals at their own `log(` call rather
    // than chosen in an argument: `infra/lib/observability.test.ts` reads the
    // codes the app emits straight off the source, and a metric filter
    // matching a code nothing writes counts zero forever without erroring.
    const failure = classifyDatabaseFailure(error);
    if (failure.unreachable)
      log("public_route.existence_unavailable", "error", { shape: shape.kind, code: failure.code });
    else reportRefusedQuery(shape.kind, failure.code, nowMs());
    return null;
  }
}

export async function proxy(req: NextRequest, _ctx: unknown): Promise<Response | undefined> {
  // The route pattern alone (isEmbeddableShopRoute) isn't a request — a plain
  // visit to /s/x with no ?embed=1 must stay denied. Only an
  // actual embed request gets the exception. `searchParams.get()` silently
  // returns just the *first* value on a repeated `?embed=1&embed=0`, which
  // would grant the framing exception here while every page's own
  // `searchParams.embed` prop receives the same repeated param as an array
  // (`!== "1"`, so the page renders its full non-embed chrome) — a page
  // framable by whoever crafted that URL. `getAll()` and requiring
  // exactly one value keeps this in lockstep with how the page reads it.
  // An embed path naming no widget is a 404 here, not in the page: the
  // static shell would already have answered 200 (see isUnknownEmbedWidgetRoute).
  // With a body: Chromium treats a bodiless error status as a failed
  // navigation (ERR_HTTP_RESPONSE_CODE_FAILURE) rather than a 404 page.
  if (isUnknownEmbedWidgetRoute(req.nextUrl.pathname)) {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  // The same refusal, one layer wider: the widget catalogue above is a closed
  // list this repository holds, and everything else in the namespace is a row
  // (see `refusedPublicRoute`). Answered by rewriting rather than by
  // a bare response, because a diver who followed a dead link is owed a page
  // rather than the word "Not found": the rewrite renders a real route, and
  // this function's remaining work — the request-header overrides that route
  // reads (REQUEST_PATH_HEADER still carries the ORIGINAL pathname, and
  // REFUSED_SHOP_SLUG_HEADER names the shop to frame the refusal as, issue
  // #765), `X-Frame-Options`, the CSP headers, the referral cookies — happens
  // to the refusal exactly as it happens to a live page. The
  // auth gate is the one thing it stands in front of, and that costs nothing:
  // every route this can refuse is in the public namespace, where the gate has
  // never had anything to say.
  //
  // **The proxy runs twice on a refusal, and the second pass is the one the
  // page sees.** Next's router applies the rewrite and then routes the new
  // path from the top, matcher included — so `proxy` is re-entered with
  // `/_not-found` as its own pathname, and every header the first pass stamped
  // is recomputed from a URL that names nothing. Left alone it blanks them
  // both: `REQUEST_PATH_HEADER` came back as the literal string
  // `/_not-found`, and the refused shop came back empty, which is a
  // shop-framed 404 silently reverting to DiveDay's sales-page one (issue
  // #765). The facts belong to the pass that did the lookups, so this pass
  // carries them rather than re-deriving them from a path they are not in.
  //
  // Carrying a value off the incoming request is the one place this file does
  // not overwrite a client-supplied header, so what forging one buys is worth
  // stating exactly. A *browser* cannot send one: no top-level navigation
  // carries a custom request header, and no cross-origin `fetch` sets an
  // `x-diveday-*` one without a preflight this app never grants. Every other
  // HTTP client can — `/_not-found` is inside the matcher at the bottom of
  // this file, so `curl` reaches this line directly with both headers set.
  // This comment used to say only same-origin script could forge one, which is
  // true of browsers and of nothing else. Blanking the pair on a direct hit is
  // not the fix: the rewrite pass above *is* a direct hit and indistinguishable
  // from one, so blanking there is issue #765 all over again.
  //
  // What it buys is a page the forger is the only reader of. The response goes
  // back to the client that sent the headers; the one route to a third party
  // was a shared cache keeping the refusal, and the `no-store` below closes
  // that. Both readers hold the value to the slug charset
  // (`shopSlugFromPublicPath`), so the most a forged one can name is a shop of
  // this app. Why that residual is left standing rather than closed by a
  // lookup is weighed where the lookup would have to go: the note on
  // `refusedShopSlug` in `src/app/not-found.tsx`.
  const isRefusalRender = req.nextUrl.pathname === NOT_FOUND_ROUTE;
  const refused = isRefusalRender ? null : await refusedPublicRoute(req);
  const embedParams = req.nextUrl.searchParams.getAll("embed");
  // A widget view is an embed by path; the schedule and trip pages are embeds
  // only with exactly one `?embed=1` (see the note above).
  const isEmbedRequest =
    isEmbedWidgetRoute(req.nextUrl.pathname) ||
    (isEmbeddableShopRoute(req.nextUrl.pathname) &&
      embedParams.length === 1 &&
      embedParams[0] === "1");
  // What the host page told the loader about itself (Harbor's "inherit the
  // host page"), validated here and forwarded as headers. Only on an embed
  // request: a visitor on the storefront itself cannot recolour it by URL.
  const embedBrand = isEmbedRequest
    ? parseEmbedBrandParam(req.nextUrl.searchParams.get("brand"))
    : null;
  const embedFont = isEmbedRequest
    ? parseEmbedFontParam(req.nextUrl.searchParams.get("font"))
    : null;
  const embedLocale = isEmbedRequest ? (req.nextUrl.searchParams.get("lang") ?? "") : "";

  // getSessionCookie/getCookieCache are pure reads. **Nothing here ever writes
  // a session cookie** — unlike next-auth's edge middleware, which is why the
  // stale-prefetch session-resurrection class of bug src/lib/session-cookies.ts
  // used to guard against no longer exists at this layer. The one Set-Cookie
  // this function issues is the partner referral below, which is not a
  // credential and carries nothing about who the reader is.
  const res = refused
    ? NextResponse.rewrite(new URL(NOT_FOUND_ROUTE, req.nextUrl))
    : ((await authGateResponse(req)) ?? NextResponse.next());
  // **A refusal says for itself that it is not cacheable.** The rewrite keeps
  // the original URL, so whatever the `/_not-found` render emits is what
  // attaches to the refused path — and a negative answer pinned at a shared
  // cache is the one failure this refusal cannot tolerate: a shop slug probed
  // an hour before onboarding finishes, or a course slug probed before the
  // shop publishes it, would go on answering 404 after the row exists. The
  // docblock above already rules that out for the process-local cache it
  // contemplates — positive results may be cached, negative ones never — and
  // this is the same rule applied to every cache in front of the app.
  //
  // Measured rather than assumed, against `next build` + `next start` on
  // 2026-09-12: the refusal already came back `private, no-cache, no-store,
  // max-age=0, must-revalidate`, which is Next's own default for a response it
  // did not prerender, and so did a live storefront. So this line fixes no
  // observed leak. It removes a dependence: the promise is this refusal's, the
  // directive was the framework's, and nothing would go red the day that
  // default changes or a CDN in front rewrites it.
  //
  // `no-store` rather than the referral cookies' `private, no-store`, and
  // stamped before them so their stronger directive wins where both apply.
  //
  // Both passes: Next routes the rewrite from the top, so the second pass sees
  // `/_not-found` with `refused` null, and a bare `notFound()` from anywhere
  // else in the app lands there too. No 404 in this product is worth caching.
  if (refused || isRefusalRender) res.headers.set("Cache-Control", "no-store");
  rememberPartnerReferral(req, res);
  rememberBuddyReferral(req, res);
  // Forward embed-mode and the request's own pathname to the server-component
  // tree — a layout can't read searchParams or the URL itself (only page.tsx
  // can), so these headers are the one way it learns "this render is going
  // into someone else's iframe" and "this is which route." Both are always
  // overridden, on the request as it continues, never left at whatever a
  // client happened to send: a spoofed value must never survive. Since the
  // public namespace split (ADR 20260803-public-shop-namespace) the embed
  // header's reader is the /s shell; the pathname header's is that namespace's
  // `not-found.tsx`, which Next hands no props at all and which would
  // otherwise have no way to know which shop's schedule to offer a diver whose
  // link died (issue #765). That reader is only safe because the value is
  // overwritten here on every proxied request rather than trusted from the
  // client, and src/proxy.test.ts pins that. `isRefusalRender` is the one
  // exception and the note beside it says why: on that pass the URL is
  // `/_not-found` and recomputing from it would throw away what the pass that
  // did the lookups already knows.
  overrideRequestHeaders(req, res, {
    [EMBED_REQUEST_HEADER]: isEmbedRequest ? "1" : "",
    [EMBED_BRAND_HEADER]: embedBrand ?? "",
    [EMBED_FONT_HEADER]: embedFont ?? "",
    [EMBED_LOCALE_HEADER]: embedLocale,
    [REQUEST_PATH_HEADER]: isRefusalRender
      ? (req.headers.get(REQUEST_PATH_HEADER) ?? req.nextUrl.pathname)
      : req.nextUrl.pathname,
    [REFUSED_SHOP_SLUG_HEADER]: isRefusalRender
      ? (req.headers.get(REFUSED_SHOP_SLUG_HEADER) ?? "")
      : (refused?.liveShopSlug ?? ""),
  });
  // Deny framing everywhere by default (clickjacking on staff/sign-in surfaces);
  // an actual embed request is the one deliberate exception, so a shop can
  // embed its booking calendar on its own website (docs ADR 20260726-schedule-embed).
  if (!isEmbedRequest) {
    res.headers.set("X-Frame-Options", "DENY");
  }
  // The rest of the policy lives in `src/lib/content-security-policy.ts` and is
  // stamped here rather than in `next.config.ts`'s `headers()` for the same
  // reason `frame-ancestors` always was: it varies per request on the embed
  // exception, and a header rule cannot read a query string (issue #718).
  //
  // An embed request still gets everything except `frame-ancestors` — the
  // exception is about who may frame the page, not about whether the page
  // itself is guarded.
  const cspOptions: CspOptions = {
    denyFraming: !isEmbedRequest,
    // `?.trim() || null`, not `?? null`: src/lib/storage/blob-host.ts trims the
    // same variables, and a policy that rejects " us-east-1" while the storage
    // adapter accepts it writes regional URLs the policy admits nothing for —
    // #1263's own failure reached through a different door. `||` rather than
    // `??` so an all-whitespace value collapses to null instead of "".
    rumRegion: process.env.NEXT_PUBLIC_RUM_REGION?.trim() || null,
    // Read here rather than wildcarded in the policy: a regional bucket host is
    // `<bucket>.s3.<region>.amazonaws.com`, and a CSP source may wildcard only
    // its leftmost label (issue #1263).
    mediaRegion: process.env.MEDIA_AWS_REGION?.trim() || null,
    // The origin media URLs are actually written against. Read rather than
    // pattern-matched, because it stops being an AWS hostname the moment the
    // distribution answers on a domain DiveDay owns (`mediaDomainName` in
    // cdk.json) -- at which point `https://*.cloudfront.net` covers nothing
    // this app serves and every photo is blocked.
    mediaPublicUrlBase: process.env.MEDIA_PUBLIC_URL_BASE?.trim() || null,
    // The WhatsApp settings page loads Meta's SDK, and it is the only page in
    // the product that loads a third-party script at all. Granting those hosts
    // here rather than app-wide keeps them off every page a diver ever sees.
    metaSignup: WHATSAPP_SETTINGS_PATH.test(req.nextUrl.pathname),
    development: process.env.NODE_ENV === "development" || process.env.DIVEDAY_E2E === "1",
  };
  const enforced = enforcedPolicy(cspOptions);
  if (enforced.length > 0) res.headers.set("Content-Security-Policy", enforced);
  res.headers.set("Content-Security-Policy-Report-Only", reportOnlyPolicy(cspOptions));
  res.headers.set("Reporting-Endpoints", reportingEndpointsHeader());
  return res;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
