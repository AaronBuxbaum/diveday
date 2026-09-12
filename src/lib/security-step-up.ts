import { eq } from "drizzle-orm";
import { getAccountSecurity, hasStepUp } from "@/db/account-security";
import type { AppDb } from "@/db/client";
import { userAccounts } from "@/db/schema";
import type { DiveDaySession } from "@/lib/auth";
import { noticeUrl, safeShopReturnPath, shopPath } from "@/lib/staff-notices";

export type StepUpPurpose = "money" | "export" | "backup";

export function isStepUpPurpose(value: string | null | undefined): value is StepUpPurpose {
  return value === "money" || value === "export" || value === "backup";
}

/**
 * Only return paths inside the current shop can be resumed after a challenge.
 *
 * The body moved to `safeShopReturnPath` when `divers/new` turned out to accept
 * a `?returnTo=` with no check at all; the name stays because the step-up
 * callers read better for it, and one implementation means the next surface to
 * accept a return path cannot re-derive a weaker one.
 */
export const safeStepUpReturnPath = safeShopReturnPath;

export function stepUpChallengeUrl(
  shopSlug: string,
  purpose: StepUpPurpose,
  returnTo: string,
): string {
  return noticeUrl(shopPath(shopSlug, "settings", "security"), "step-up-required", {
    purpose,
    returnTo,
  });
}

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
