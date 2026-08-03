import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import {
  authConfig,
  EMBED_REQUEST_HEADER,
  isEmbeddableShopRoute,
  REQUEST_PATH_HEADER,
} from "@/lib/auth.config";
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

export async function proxy(req: NextRequest, ctx: unknown): Promise<Response | undefined> {
  // The route pattern alone (isEmbeddableShopRoute) isn't a request — a plain
  // visit to /shop/x/schedule with no ?embed=1 must stay denied. Only an
  // actual embed request gets the exception. `searchParams.get()` silently
  // returns just the *first* value on a repeated `?embed=1&embed=0`, which
  // would grant the framing exception here while every page's own
  // `searchParams.embed` prop receives the same repeated param as an array
  // (`!== "1"`, so the page renders full staff chrome) — a signed-in staff
  // dashboard framable by whoever crafted that URL. `getAll()` and requiring
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
  // tree — `ShopLayout` can't read searchParams or the URL itself (only
  // page.tsx can), so these headers are the one way it learns "this render is
  // going into someone else's iframe" and "this is which route." Both are
  // always overridden, on the request as it continues, never left at whatever
  // a client happened to send: a spoofed value must never survive. The
  // pathname one is what lets `ShopLayout` apply `isPublicShopRoute` — the
  // same predicate the `authorized` gate above already runs on the same
  // `nextUrl.pathname` — so a cross-tenant staff visit 404s while this shop's
  // public schedule and course pages keep rendering for anyone.
  overrideRequestHeaders(req, res, {
    [EMBED_REQUEST_HEADER]: isEmbedRequest ? "1" : "",
    [REQUEST_PATH_HEADER]: req.nextUrl.pathname,
  });
  // Deny framing everywhere by default (clickjacking on staff/sign-in surfaces);
  // an actual embed request is the one deliberate exception, so a shop can
  // embed its booking calendar on its own website (docs ADR 20260726-schedule-embed).
  if (!isEmbedRequest) {
    res.headers.set("X-Frame-Options", "DENY");
    res.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  }
  return res;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
