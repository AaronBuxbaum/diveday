import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authConfig, EMBED_REQUEST_HEADER, isEmbeddableShopRoute } from "@/lib/auth.config";
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
 * spec-extension/response.js `handleMiddlewareField`). Applying it directly,
 * rather than only via that constructor option, means it lands regardless of
 * *which* response object ends up returned: `authMiddleware` sometimes
 * constructs its own (e.g. to refresh a session cookie) even when the
 * request is simply allowed through, and that response's own request-header
 * overrides — if it set any — must not be clobbered, only added to.
 */
function overrideRequestHeader(res: Response, name: string, value: string): void {
  res.headers.set(`x-middleware-request-${name}`, value);
  const existing = res.headers.get("x-middleware-override-headers");
  const keys = new Set(
    (existing ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean),
  );
  keys.add(name);
  res.headers.set("x-middleware-override-headers", [...keys].join(","));
}

export async function proxy(req: NextRequest, ctx: unknown): Promise<Response | undefined> {
  // The route pattern alone (isEmbeddableShopRoute) isn't a request — a plain
  // visit to /shop/x/schedule with no ?embed=1 must stay denied. Only an
  // actual embed request gets the exception.
  const isEmbedRequest =
    isEmbeddableShopRoute(req.nextUrl.pathname) && req.nextUrl.searchParams.get("embed") === "1";

  // authMiddleware only returns a Response for a redirect/deny; letting a
  // request through (the common case) can *also* return its own Response
  // rather than undefined (observed: it stamps a session/callback cookie
  // even on an allowed request), so `?? NextResponse.next()` is not a
  // reliable signal for "which object do I attach headers to" — always
  // attach to whatever came back, falling back to a plain pass-through only
  // when nothing did.
  const res = (await authMiddleware(req, ctx)) ?? NextResponse.next();
  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (setCookies.length > 0) {
    const kept = stripSessionSetCookies(setCookies);
    if (kept.length !== setCookies.length) {
      res.headers.delete("set-cookie");
      for (const cookie of kept) res.headers.append("set-cookie", cookie);
    }
  }
  // Forward embed-mode to the server-component tree — `ShopLayout` can't
  // read searchParams itself (only page.tsx can), so this header is the one
  // way it learns "this render is going into someone else's iframe." Always
  // overridden, on the request as it continues, never left at whatever a
  // client happened to send: a spoofed value must never survive.
  overrideRequestHeader(res, EMBED_REQUEST_HEADER, isEmbedRequest ? "1" : "");
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
