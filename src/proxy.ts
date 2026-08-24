import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import {
  authConfig,
  EMBED_REQUEST_HEADER,
  isEmbeddableShopRoute,
  REQUEST_PATH_HEADER,
} from "@/lib/auth.config";
import {
  type CspOptions,
  enforcedPolicy,
  reportingEndpointsHeader,
  reportOnlyPolicy,
} from "@/lib/content-security-policy";
import { stripSessionSetCookies } from "@/lib/session-cookies";

// Route protection at the edge (Next 16 proxy convention; middleware is
// deprecated). Server code re-checks via requireStaffSession() — this is
// the outer layer, never the only one (ADR-0006). The bare `.auth` middleware
// runs the `authorized` callback (allow/deny + redirects) from authConfig.
const authMiddleware = NextAuth(authConfig).auth as unknown as (
  req: NextRequest,
  ctx: unknown,
) => Promise<Response | undefined>;

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

export async function proxy(req: NextRequest, ctx: unknown): Promise<Response | undefined> {
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

  // authMiddleware only returns a Response for a redirect/deny; letting a
  // request through (the common case) can *also* return its own Response
  // rather than undefined (observed: it stamps a session/callback cookie
  // even on an allowed request), so `?? NextResponse.next()` is not a
  // reliable signal for "which object do I attach headers to" — always
  // attach to whatever came back, falling back to a plain pass-through only
  // when nothing did. overrideRequestHeader always rebuilds the override
  // list from the original request, so it's safe regardless of which Response
  // this ends up being.
  const res = (await authMiddleware(req, ctx)) ?? NextResponse.next();
  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (setCookies.length > 0) {
    const kept = stripSessionSetCookies(setCookies);
    if (kept.length !== setCookies.length) {
      res.headers.delete("set-cookie");
      for (const cookie of kept) res.headers.append("set-cookie", cookie);
    }
  }
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
