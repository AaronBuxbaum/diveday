import { and, eq, gt } from "drizzle-orm";
import { readActiveStaffRoles } from "@/db/authz";
import { lockBoardingCertificationEvidence } from "@/db/boarding-certification-snapshot";
import type { DbExecutor } from "@/db/client";
import { accountSessions, people, personRoles, userAccounts } from "@/db/schema";
import { isStaff } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { STAFF_IDLE_LIMIT_MS } from "@/lib/session-idle";

type ReviewActor = { shopId: string; staffPersonId: string; sessionId: string };

/** Hold the existing erasure and authorization locks through this transaction. */
export async function lockReviewAccess(tx: DbExecutor, input: ReviewActor): Promise<boolean> {
  await lockBoardingCertificationEvidence(tx, input.shopId, "boarding");
  await tx
    .select({ id: people.id })
    .from(people)
    // diveday:allow-deleted-people: lock before the live authorization check.
    .where(eq(people.id, input.staffPersonId))
    .for("share");
  await tx
    .select({ id: userAccounts.id })
    .from(userAccounts)
    .where(eq(userAccounts.personId, input.staffPersonId))
    .for("share");
  await tx
    .select({ role: personRoles.role })
    .from(personRoles)
    .where(eq(personRoles.personId, input.staffPersonId))
    .for("share");
  const now = nowDate();
  const [session] = await tx
    .select({ id: accountSessions.id })
    .from(accountSessions)
    .innerJoin(userAccounts, eq(userAccounts.id, accountSessions.userAccountId))
    .where(
      and(
        eq(accountSessions.id, input.sessionId),
        eq(accountSessions.personId, input.staffPersonId),
        eq(accountSessions.shopId, input.shopId),
        eq(userAccounts.personId, input.staffPersonId),
        eq(userAccounts.status, "active"),
        gt(accountSessions.expiresAt, now),
        gt(accountSessions.lastHumanActivityAt, new Date(now.getTime() - STAFF_IDLE_LIMIT_MS)),
      ),
    )
    .for("share");
  if (!session) return false;
  const roles = await readActiveStaffRoles(tx, input.shopId, input.staffPersonId);
  return Boolean(roles && isStaff(roles));
}

/** A lock cannot stop time: repeat expiry and idle checks before returning. */
export async function reviewSessionStillLive(tx: DbExecutor, sessionId: string): Promise<boolean> {
  const now = nowDate();
  const [session] = await tx
    .select({ id: accountSessions.id })
    .from(accountSessions)
    .where(
      and(
        eq(accountSessions.id, sessionId),
        gt(accountSessions.expiresAt, now),
        gt(accountSessions.lastHumanActivityAt, new Date(now.getTime() - STAFF_IDLE_LIMIT_MS)),
      ),
    );
  return Boolean(session);
}
