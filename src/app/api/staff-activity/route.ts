import { loadActiveStaffRoles } from "@/db/authz";
import { getDb } from "@/db/client";
import { touchStaffSession } from "@/db/session-activity";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { withE2EApiTiming } from "@/lib/observability/query-timing";
import { isCrossSiteHeaders } from "@/lib/same-origin";

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
  return touched
    ? new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } })
    : Response.json({ error: "authentication_required" }, { status: 401 });
}

export function POST(request: Request) {
  return withE2EApiTiming("/api/staff-activity POST", () => postStaffActivity(request));
}
