import { getCookieCache, getSessionCookie } from "better-auth/cookies";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authSecret } from "@/lib/auth-secret";
import { isStaff, type Role } from "@/lib/authz";
import {
  type CspOptions,
  enforcedPolicy,
  reportingEndpointsHeader,
  reportOnlyPolicy,
} from "@/lib/content-security-policy";
import {
  EMBED_REQUEST_HEADER,
  isEmbeddableShopRoute,
  REQUEST_PATH_HEADER,
} from "@/lib/embed-routes";

const STAFF_PREFIX = "/shop";

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
  const embedParams = req.nextUrl.searchParams.getAll("embed");
  const isEmbedRequest =
    isEmbeddableShopRoute(req.nextUrl.pathname) &&
    embedParams.length === 1 &&
    embedParams[0] === "1";

  // getSessionCookie/getCookieCache are pure reads — unlike next-auth's edge
  // middleware, nothing here ever issues a Set-Cookie, so there is no longer
  // a stale-prefetch session-resurrection class of bug to guard against at
  // this layer (the property src/lib/session-cookies.ts used to protect;
  // removed alongside next-auth for exactly this reason).
  const res = (await authGateResponse(req)) ?? NextResponse.next();
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
  // client, and src/proxy.test.ts pins that.
  overrideRequestHeaders(req, res, {
    [EMBED_REQUEST_HEADER]: isEmbedRequest ? "1" : "",
    [REQUEST_PATH_HEADER]: req.nextUrl.pathname,
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
    rumRegion: process.env.NEXT_PUBLIC_RUM_REGION ?? null,
    // The WhatsApp settings page loads Meta's SDK, and it is the only page in
    // the product that loads a third-party script at all. Granting those hosts
    // here rather than app-wide keeps them off every page a diver ever sees.
    metaSignup: WHATSAPP_SETTINGS_PATH.test(req.nextUrl.pathname),
    development: process.env.NODE_ENV === "development",
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
