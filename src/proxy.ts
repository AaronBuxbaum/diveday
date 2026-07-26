import type { NextRequest } from "next/server";
import NextAuth from "next-auth";
import { authConfig, isEmbeddableShopRoute } from "@/lib/auth.config";
import { stripSessionSetCookies } from "@/lib/session-cookies";

// Route protection at the edge (Next 16 proxy convention; middleware is
// deprecated). Server code re-checks via requireStaffSession() — this is
// the outer layer, never the only one (ADR-0006). The bare `.auth` middleware
// runs the `authorized` callback (allow/deny + redirects) from authConfig.
const authMiddleware = NextAuth(authConfig).auth as unknown as (
  req: NextRequest,
  ctx: unknown,
) => Promise<Response | undefined>;

export async function proxy(req: NextRequest, ctx: unknown): Promise<Response | undefined> {
  const res = await authMiddleware(req, ctx);
  if (!res) return res;
  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (setCookies.length > 0) {
    const kept = stripSessionSetCookies(setCookies);
    if (kept.length !== setCookies.length) {
      res.headers.delete("set-cookie");
      for (const cookie of kept) res.headers.append("set-cookie", cookie);
    }
  }
  // Deny framing everywhere by default (clickjacking on staff/sign-in surfaces);
  // the schedule/trip pages are the one deliberate exception, so a shop can
  // embed its booking calendar on its own website (docs ADR 20260726-schedule-embed).
  if (!isEmbeddableShopRoute(req.nextUrl.pathname)) {
    res.headers.set("X-Frame-Options", "DENY");
    res.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  }
  return res;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
