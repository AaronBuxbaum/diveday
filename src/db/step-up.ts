import { eq } from "drizzle-orm";
import type { DiveDaySession } from "@/lib/auth";
import type { StepUpPurpose } from "@/lib/security-step-up";
import { getAccountSecurity, hasStepUp } from "./account-security";
import type { AppDb } from "./client";
import { userAccounts } from "./schema";

/**
 * TOTP is optional. When it is enabled, every sensitive operation must have a
 * live grant tied to this exact Better Auth session; a grant from another
 * browser or from a revoked session never satisfies the check.
 */
export async function hasRequiredStepUp(
  db: AppDb,
  session: DiveDaySession,
  purpose: StepUpPurpose,
): Promise<boolean> {
  const accountId =
    session.user.userAccountId ??
    (
      await db
        .select({ id: userAccounts.id })
        .from(userAccounts)
        .where(eq(userAccounts.personId, session.user.personId))
        .limit(1)
    )[0]?.id;
  if (!accountId) return false;
  const security = await getAccountSecurity(db, accountId);
  if (!security?.totpEnabledAt) return true;
  const sessionId = session.user.sessionId;
  if (!sessionId) return false;
  return hasStepUp(db, {
    userAccountId: accountId,
    accountSessionId: sessionId,
    purpose,
  });
}
