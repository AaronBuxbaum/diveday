import { eq } from "drizzle-orm";
import { getAccountSecurity, hasStepUp } from "@/db/account-security";
import type { AppDb } from "@/db/client";
import { userAccounts } from "@/db/schema";
import type { DiveDaySession } from "@/lib/auth";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

export type StepUpPurpose = "money" | "export" | "backup";

export function isStepUpPurpose(value: string | null | undefined): value is StepUpPurpose {
  return value === "money" || value === "export" || value === "backup";
}

/** Only return paths inside the current shop can be resumed after a challenge. */
export function safeStepUpReturnPath(shopSlug: string, value: string | null | undefined) {
  if (!value) return null;
  const prefix = `${shopPath(shopSlug)}/`;
  if (!value.startsWith(prefix) || value.startsWith("//")) return null;
  try {
    const parsed = new URL(value, "https://diveday.invalid");
    if (parsed.origin !== "https://diveday.invalid" || !parsed.pathname.startsWith(prefix)) {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

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
