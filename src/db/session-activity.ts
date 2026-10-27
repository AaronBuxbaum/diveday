import { and, eq, gt, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { STAFF_IDLE_LIMIT_MS } from "@/lib/session-idle";
import type { DbExecutor } from "./client";
import { accountSessions } from "./schema";

/** An atomic touch cannot revive an expired or revoked session. */
export async function touchStaffSession(
  db: DbExecutor,
  key: { sessionId: string; userAccountId: string; personId: string; shopId: string },
  clock: () => Date = nowDate,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Obtain the clock only after the lock: a request held up at the boundary
    // must not use its earlier arrival time to resurrect an expired session.
    const locked = await tx
      .select({ id: accountSessions.id })
      .from(accountSessions)
      .where(
        and(
          eq(accountSessions.id, key.sessionId),
          eq(accountSessions.userAccountId, key.userAccountId),
          eq(accountSessions.personId, key.personId),
          eq(accountSessions.shopId, key.shopId),
        ),
      )
      .for("update");
    if (locked.length !== 1) return false;
    const now = clock();
    const cutoff = new Date(now.getTime() - STAFF_IDLE_LIMIT_MS);
    const rows = await tx
      .update(accountSessions)
      .set({
        lastHumanActivityAt: sql`greatest(${accountSessions.lastHumanActivityAt}, ${now})`,
      })
      .where(
        and(
          eq(accountSessions.id, key.sessionId),
          eq(accountSessions.userAccountId, key.userAccountId),
          eq(accountSessions.personId, key.personId),
          eq(accountSessions.shopId, key.shopId),
          gt(accountSessions.expiresAt, now),
          gt(accountSessions.lastHumanActivityAt, cutoff),
        ),
      )
      .returning({ id: accountSessions.id });
    return rows.length === 1;
  });
}
