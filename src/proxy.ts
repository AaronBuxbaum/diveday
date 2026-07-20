import type { NextRequest } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Route protection at the edge (Next 16 proxy convention; middleware is
// deprecated). Server code re-checks via requireStaffSession() — this is
// the outer layer, never the only one (ADR-0006). The bare `.auth` middleware
// runs the `authorized` callback (allow/deny + redirects) from authConfig.
const authMiddleware = NextAuth(authConfig).auth as unknown as (
  req: NextRequest,
  ctx: unknown,
) => Promise<Response | undefined>;

// Auth.js re-issues the rolling session cookie on *every* request the middleware
// sees, including Next.js prefetches. A prefetch (or any in-flight request) that
// still carries the pre-sign-out cookie can land just after a sign-out, and its
// refreshed `Set-Cookie` then overwrites the sign-out's clear — silently
// resurrecting the session. The proxy is a read-only authorization layer, so it
// must never *write* the session cookie: the real sign-in / sign-out flows in
// the node runtime own it. Strip any session-token `Set-Cookie` the proxy emits,
// leaving csrf/callback cookies and redirect headers untouched.
const SESSION_COOKIE = /^(?:__Secure-|__Host-)?authjs\.session-token(?:\.\d+)?=/;

export async function proxy(req: NextRequest, ctx: unknown): Promise<Response | undefined> {
  const res = await authMiddleware(req, ctx);
  if (!res) return res;
  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (setCookies.length === 0) return res;
  const kept = setCookies.filter((cookie) => !SESSION_COOKIE.test(cookie));
  if (kept.length !== setCookies.length) {
    res.headers.delete("set-cookie");
    for (const cookie of kept) res.headers.append("set-cookie", cookie);
  }
  return res;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
