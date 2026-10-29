"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  beginTotpEnrollment,
  disableTotp,
  enableTotp,
  getAccountSecurity,
  grantStepUp,
  refreshAccountRecoveryCodes,
  revokeAccountSession,
  revokeAllAccountSessions,
  verifyAccountSecondFactor,
} from "@/db/account-security";
import { getAccountIdForPerson } from "@/db/user-accounts";
import { parseForm, readForm, single, text } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { sealSecret, secretKeyFromEnvironment } from "@/lib/secret-box";
import { isStepUpPurpose, safeStepUpReturnPath } from "@/lib/security-step-up";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

const RECOVERY_CODES_COOKIE = "diveday_totp_recovery_codes";

/**
 * Bounds second-factor guessing at every door that accepts a code.
 *
 * The caller here already holds a session, so this is not the sign-in net --
 * it is what stops a stolen cookie grinding the million codes in a 30-second
 * window. `disableTotpAction` makes that urgent rather than theoretical: one
 * hit there clears the secret and every recovery hash, and nothing else stands
 * in front of it. Two dimensions so one attacker cannot fan out across
 * accounts, and both are spent before the code is looked at.
 */
async function secondFactorAttemptAllowed(accountId: string): Promise<boolean> {
  const ip = await clientIp();
  const [byAccount, byIp] = await Promise.all([
    checkRateLimit(rateLimitKey("second-factor", accountId), RATE_LIMITS.secondFactorByAccount),
    checkRateLimit(rateLimitKey("second-factor-ip", ip), RATE_LIMITS.secondFactorByIp),
  ]);
  return byAccount.allowed && byIp.allowed;
}

async function securityContext(shopSlug: string) {
  const surface = await requireShopSurface(shopSlug);
  const accountId = await getAccountIdForPerson(surface.db, surface.session.user.personId);
  if (!accountId)
    redirect(noticeUrl(shopPath(shopSlug, "settings", "security"), "security-invalid"));
  return { ...surface, accountId };
}

export async function beginTotpEnrollmentAction(shopSlug: string) {
  const { db, accountId } = await securityContext(shopSlug);
  const started = await beginTotpEnrollment(db, accountId);
  if (started) {
    const key = secretKeyFromEnvironment();
    if (key.status === "ok") {
      const cookieStore = await cookies();
      cookieStore.set(
        RECOVERY_CODES_COOKIE,
        sealSecret(JSON.stringify({ accountId, codes: started.recoveryCodes }), key.key),
        {
          httpOnly: true,
          maxAge: 10 * 60,
          path: "/",
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
        },
      );
    }
  }
  revalidateAndRedirect(
    shopPath(shopSlug, "settings", "security"),
    noticeUrl(
      shopPath(shopSlug, "settings", "security"),
      started ? "enrollment-started" : "security-unavailable",
    ),
  );
}

/** A fresh authenticator code, the one thing enrolment accepts. */
const totpCodeForm = z.object({ code: single(z.string().regex(/^\d{6}$/)) });
/** An authenticator code or a recovery code, whichever the account holder typed. */
const secondFactorForm = z.object({ code: single(z.string().trim().min(6).max(32)) });
const sessionIdForm = z.object({ sessionId: single(z.string().uuid()) });
const stepUpForm = z.object({ purpose: text(), returnTo: text() });

function secondFactorCode(formData: FormData) {
  const parsed = parseForm(secondFactorForm, formData);
  return parsed.ok
    ? { success: true as const, data: parsed.data.code }
    : { success: false as const };
}

export async function enableTotpAction(shopSlug: string, formData: FormData) {
  const { db, accountId } = await securityContext(shopSlug);
  if (!(await secondFactorAttemptAllowed(accountId))) {
    redirect(noticeUrl(shopPath(shopSlug, "settings", "security"), "too-many-attempts"));
  }
  const code = parseForm(totpCodeForm, formData);
  const enabled = code.ok && (await enableTotp(db, accountId, code.data.code));
  revalidateAndRedirect(
    shopPath(shopSlug, "settings", "security"),
    noticeUrl(
      shopPath(shopSlug, "settings", "security"),
      enabled ? "two-factor-enabled" : "code-invalid",
    ),
  );
}

export async function disableTotpAction(shopSlug: string, formData: FormData) {
  const { db, accountId } = await securityContext(shopSlug);
  const security = await getAccountSecurity(db, accountId);
  if (security?.totpEnabledAt && !(await secondFactorAttemptAllowed(accountId))) {
    redirect(noticeUrl(shopPath(shopSlug, "settings", "security"), "too-many-attempts"));
  }
  const code = secondFactorCode(formData);
  const accepted =
    !security?.totpEnabledAt ||
    (code.success &&
      (await verifyAccountSecondFactor(db, accountId, code.data, { consumeTotpStep: false })));
  if (!accepted) redirect(noticeUrl(shopPath(shopSlug, "settings", "security"), "code-invalid"));
  await disableTotp(db, accountId);
  (await cookies()).delete(RECOVERY_CODES_COOKIE);
  revalidateAndRedirect(
    shopPath(shopSlug, "settings", "security"),
    noticeUrl(shopPath(shopSlug, "settings", "security"), "two-factor-disabled"),
  );
}

export async function refreshRecoveryCodesAction(shopSlug: string, formData: FormData) {
  const { db, accountId } = await securityContext(shopSlug);
  if (!(await secondFactorAttemptAllowed(accountId))) {
    redirect(noticeUrl(shopPath(shopSlug, "settings", "security"), "too-many-attempts"));
  }
  const key = secretKeyFromEnvironment();
  if (key.status !== "ok") {
    redirect(noticeUrl(shopPath(shopSlug, "settings", "security"), "security-unavailable"));
  }
  const code = secondFactorCode(formData);
  if (!code.success) {
    redirect(noticeUrl(shopPath(shopSlug, "settings", "security"), "code-invalid"));
  }

  const result = await refreshAccountRecoveryCodes(db, accountId, code.data);
  if (!result.ok) {
    redirect(
      noticeUrl(
        shopPath(shopSlug, "settings", "security"),
        result.reason === "invalid" ? "code-invalid" : "security-unavailable",
      ),
    );
  }

  const cookieStore = await cookies();
  cookieStore.set(
    RECOVERY_CODES_COOKIE,
    sealSecret(JSON.stringify({ accountId, codes: result.codes }), key.key),
    {
      httpOnly: true,
      maxAge: 10 * 60,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  );
  revalidateAndRedirect(shopPath(shopSlug, "settings", "security"));
}

export async function revokeSessionAction(shopSlug: string, formData: FormData) {
  const { db, accountId } = await securityContext(shopSlug);
  const sessionId = parseForm(sessionIdForm, formData);
  if (!sessionId.ok)
    redirect(noticeUrl(shopPath(shopSlug, "settings", "security"), "security-invalid"));
  await revokeAccountSession(db, accountId, sessionId.data.sessionId);
  revalidateAndRedirect(
    shopPath(shopSlug, "settings", "security"),
    noticeUrl(shopPath(shopSlug, "settings", "security"), "session-revoked"),
  );
}

export async function revokeAllSessionsAction(shopSlug: string) {
  const { db, accountId } = await securityContext(shopSlug);
  await revokeAllAccountSessions(db, accountId);
  redirect("/sign-in?session=ended");
}

export async function verifyStepUpAction(shopSlug: string, formData: FormData) {
  const { db, accountId, session } = await securityContext(shopSlug);
  if (!(await secondFactorAttemptAllowed(accountId))) {
    redirect(noticeUrl(shopPath(shopSlug, "settings", "security"), "too-many-attempts"));
  }
  const stepUp = readForm(stepUpForm, formData);
  const purposeValue = stepUp.purpose;
  const returnTo = safeStepUpReturnPath(shopSlug, stepUp.returnTo);
  const code = secondFactorCode(formData);
  if (!isStepUpPurpose(purposeValue) || !returnTo || !code.success || !session.user.sessionId) {
    redirect(noticeUrl(shopPath(shopSlug, "settings", "security"), "security-invalid"));
  }
  const accepted = await verifyAccountSecondFactor(db, accountId, code.data, {
    consumeTotpStep: false,
  });
  if (!accepted) {
    redirect(
      noticeUrl(shopPath(shopSlug, "settings", "security"), "code-invalid", {
        purpose: purposeValue,
        returnTo,
      }),
    );
  }
  const granted = await grantStepUp(db, {
    userAccountId: accountId,
    accountSessionId: session.user.sessionId,
    purpose: purposeValue,
  });
  if (!granted) {
    redirect(noticeUrl(shopPath(shopSlug, "settings", "security"), "security-invalid"));
  }
  redirect(returnTo);
}
