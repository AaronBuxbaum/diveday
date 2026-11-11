import { eq } from "drizzle-orm";
import type { StepUpPurpose } from "@/features/security-step-up";
import { getAccountSecurity, hasStepUp } from "../../db/account-security";
import type { AppDb } from "../../db/client";
import { listAccountPasskeys } from "../../db/passkeys";
import { userAccounts } from "../../db/schema/index";
import type { DiveDaySession } from "../../lib/auth";

/**
 * TOTP and passkeys are optional. With either enrolled, every sensitive operation needs a
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
  if (
    !security?.totpEnabledAt &&
    !(await listAccountPasskeys(db, accountId, session.user.shopId)).length
  )
    return true;
  const sessionId = session.user.sessionId;
  if (!sessionId) return false;
  return hasStepUp(db, {
    userAccountId: accountId,
    accountSessionId: sessionId,
    purpose,
  });
}
