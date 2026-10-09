import { NextResponse } from "next/server";
import {
  isDemoQuietKey,
  QUIET_DEMO_COOKIE,
  QUIET_DEMO_COOKIE_MAX_AGE,
  QUIET_DEMO_PARAM,
  quietDemoToken,
} from "@/lib/quiet-demo-device";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * Mark this browser as the founder's, so a demo he opens from it sends no
 * alert (`src/lib/quiet-demo-device.ts`). The proof is `DEMO_QUIET_KEY`,
 * carried as `?key=`, which the telemetry redaction blanks
 * (`capability-urls.ts`).
 *
 * A wrong or missing key is a plain 404, the same answer as a route that does
 * not exist; the right one lands on the homepage with the cookie set.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  // A 404 and a redirect tell a wrong key from a right one, so guesses are
  // throttled the way every other door that checks a secret is.
  const ip = await clientIp(request.headers);
  if (!(await checkRateLimit(rateLimitKey("demo-quiet", ip), RATE_LIMITS.demoQuiet)).allowed) {
    return new NextResponse(null, { status: 429, headers: NO_STORE });
  }
  const token = quietDemoToken();
  if (!token || !isDemoQuietKey(url.searchParams.get(QUIET_DEMO_PARAM))) {
    return new NextResponse(null, { status: 404, headers: NO_STORE });
  }
  const response = NextResponse.redirect(new URL("/", url), { headers: NO_STORE });
  response.cookies.set(QUIET_DEMO_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: QUIET_DEMO_COOKIE_MAX_AGE,
  });
  return response;
}
