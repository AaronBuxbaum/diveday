import type { NextRequest } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
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
  if (setCookies.length === 0) return res;
  const kept = stripSessionSetCookies(setCookies);
  if (kept.length !== setCookies.length) {
    res.headers.delete("set-cookie");
    for (const cookie of kept) res.headers.append("set-cookie", cookie);
  }
  return res;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
