import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { accountSessions } from "@/db/schema";
import { auth } from "@/lib/auth";
import { nowDate } from "@/lib/clock";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";
import { STAFF_IDLE_LIMIT_MS } from "@/lib/session-idle";

/** Age only the calling test's session; never enabled with a real database. */
export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request))
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { age?: unknown } | null;
  if (body?.age !== "idle") return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const user = (await auth())?.user;
  if (!user?.sessionId || !user.userAccountId) return new Response(null, { status: 401 });
  const db = await getDb();
  const rows = await db
    .update(accountSessions)
    .set({ lastHumanActivityAt: new Date(nowDate().getTime() - STAFF_IDLE_LIMIT_MS) })
    .where(
      and(
        eq(accountSessions.id, user.sessionId),
        eq(accountSessions.userAccountId, user.userAccountId),
        eq(accountSessions.shopId, user.shopId),
      ),
    )
    .returning({ id: accountSessions.id });
  return new Response(null, { status: rows.length === 1 ? 204 : 401 });
}
