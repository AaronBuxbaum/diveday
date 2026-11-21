import { after } from "next/server";
import { announcePreviewActivity } from "@/app/actions/demo-instrumentation";
import { loadActiveStaffRoles } from "@/db/authz";
import { getDb } from "@/db/client";
import { touchStaffSession } from "@/features/accounts/session-activity";
import { isQuietDemoDevice, QUIET_DEMO_COOKIE } from "@/features/demo/quiet-demo-device";
import { isCrossSiteHeaders } from "@/features/platform/same-origin";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { withE2EApiTiming } from "@/lib/observability/query-timing";

/** Check the server's deadline without treating a background read as activity. */
async function getStaffActivity(request: Request) {
  const session = await auth();
  if (
    !session?.user ||
    !isStaff(session.user.roles) ||
    session.idleRemainingMs === undefined ||
    !session.user.sessionId ||
    request.headers.get("x-staff-session") !== session.user.sessionId
  )
    return Response.json({ error: "authentication_required" }, { status: 401 });
  const db = await getDb();
  if (
    !isStaff(
      (await loadActiveStaffRoles(db, session.user.shopId, session.user.personId)) ?? undefined,
    )
  )
    return Response.json({ error: "authentication_required" }, { status: 401 });
  return Response.json(
    { remainingMs: session.idleRemainingMs },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export function GET(request: Request) {
  return withE2EApiTiming("/api/staff-activity GET", () => getStaffActivity(request));
}

/** One cookie off the request itself, so the handler reads no ambient request scope. */
function requestCookie(request: Request, name: string): string | undefined {
  for (const pair of (request.headers.get("cookie") ?? "").split(";")) {
    const at = pair.indexOf("=");
    if (at > 0 && pair.slice(0, at).trim() === name) return pair.slice(at + 1).trim();
  }
  return undefined;
}

/** Record an input for this session, never a passive refresh or another device. */
async function postStaffActivity(request: Request) {
  if (isCrossSiteHeaders(request.headers))
    return Response.json({ error: "cross_site" }, { status: 403 });
  const session = await auth();
  const user = session?.user;
  if (
    !user?.sessionId ||
    request.headers.get("x-staff-session") !== user.sessionId ||
    !user.userAccountId ||
    !isStaff(user.roles)
  )
    return Response.json({ error: "authentication_required" }, { status: 401 });
  const db = await getDb();
  if (!isStaff((await loadActiveStaffRoles(db, user.shopId, user.personId)) ?? undefined))
    return Response.json({ error: "authentication_required" }, { status: 401 });
  const touched = await touchStaffSession(db, {
    sessionId: user.sessionId,
    userAccountId: user.userAccountId,
    personId: user.personId,
    shopId: user.shopId,
  });
  // This touch is the one signal in the product that is a person at a keyboard,
  // so it is also what tells the founder a prospect is using their preview
  // (ADR 20261116-demo-previews). After the response, and never for a browser
  // the founder marked as his own.
  if (touched) {
    const quiet = isQuietDemoDevice(requestCookie(request, QUIET_DEMO_COOKIE));
    if (!quiet) after(() => announcePreviewActivity(user.shopId));
  }
  return touched
    ? new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } })
    : Response.json({ error: "authentication_required" }, { status: 401 });
}

export function POST(request: Request) {
  return withE2EApiTiming("/api/staff-activity POST", () => postStaffActivity(request));
}
