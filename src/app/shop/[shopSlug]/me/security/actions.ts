"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  disableTotp,
  getAccountSecurity,
  grantStepUp,
  refreshAccountRecoveryCodes,
  revokeAccountSession,
  revokeAllAccountSessions,
  verifyAccountSecondFactor,
} from "@/db/account-security";
import {
  authorizeFactorManagementPassword,
  beginProtectedTotpEnrollment,
  enableProtectedTotp,
} from "@/db/passkeys";
import { getAccountIdForPerson } from "@/db/user-accounts";
import { parseForm, readForm, single, text } from "@/features/form-parse";
import { revalidateAndRedirect } from "@/features/navigation";
import { isStepUpPurpose, safeStepUpReturnPath } from "@/features/security-step-up";
import { requireShopSurface } from "@/features/session";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { runtimeMode } from "@/lib/runtime-mode";
import { sealSecret, secretKeyFromEnvironment } from "@/lib/secret-box";
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
  if (!accountId) redirect(noticeUrl(shopPath(shopSlug, "me", "security"), "security-invalid"));
  return { ...surface, accountId };
}

function factorBinding(
  accountId: string,
  session: Awaited<ReturnType<typeof securityContext>>["session"],
) {
  return session.user.sessionId
    ? {
        userAccountId: accountId,
        accountSessionId: session.user.sessionId,
        shopId: session.user.shopId,
      }
    : null;
}

export async function verifyFactorManagementPasswordAction(shopSlug: string, formData: FormData) {
  const { db, accountId, session } = await securityContext(shopSlug);
  if (!(await secondFactorAttemptAllowed(accountId)))
    redirect(noticeUrl(shopPath(shopSlug, "me", "security"), "too-many-attempts"));
  const binding = factorBinding(accountId, session);
  const password = formData.get("password");
  const accepted =
    binding &&
    typeof password === "string" &&
    password.length > 0 &&
    password.length <= 1000 &&
    (await authorizeFactorManagementPassword(db, binding, password));
  revalidateAndRedirect(
    shopPath(shopSlug, "me", "security"),
    noticeUrl(
      shopPath(shopSlug, "me", "security"),
      accepted ? "security-proof-verified" : "security-proof-invalid",
    ),
  );
}

export async function beginTotpEnrollmentAction(shopSlug: string) {
  const { db, accountId, session } = await securityContext(shopSlug);
  const binding = factorBinding(accountId, session);
  const started = binding ? await beginProtectedTotpEnrollment(db, binding) : null;
  if (!started || started.status === "proof_required")
    redirect(noticeUrl(shopPath(shopSlug, "me", "security"), "security-proof-required"));
  if (started.status === "started") {
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
          secure: runtimeMode().secureCookies,
        },
      );
    }
  }
  revalidateAndRedirect(
    shopPath(shopSlug, "me", "security"),
    noticeUrl(
      shopPath(shopSlug, "me", "security"),
      started.status === "started" ? "enrollment-started" : "security-unavailable",
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
  const { db, accountId, session } = await securityContext(shopSlug);
  if (!(await secondFactorAttemptAllowed(accountId))) {
    redirect(noticeUrl(shopPath(shopSlug, "me", "security"), "too-many-attempts"));
  }
  const code = parseForm(totpCodeForm, formData);
  const binding = factorBinding(accountId, session);
  const result = code.ok && binding ? await enableProtectedTotp(db, binding, code.data.code) : null;
  if (result?.status === "proof_required")
    redirect(noticeUrl(shopPath(shopSlug, "me", "security"), "security-proof-required"));
  const enabled = result?.status === "checked" && result.enabled;
  revalidateAndRedirect(
    shopPath(shopSlug, "me", "security"),
    noticeUrl(
      shopPath(shopSlug, "me", "security"),
      enabled ? "two-factor-enabled" : "code-invalid",
    ),
  );
}

export async function disableTotpAction(shopSlug: string, formData: FormData) {
  const { db, accountId } = await securityContext(shopSlug);
  const security = await getAccountSecurity(db, accountId);
  if (security?.totpEnabledAt && !(await secondFactorAttemptAllowed(accountId))) {
    redirect(noticeUrl(shopPath(shopSlug, "me", "security"), "too-many-attempts"));
  }
  const code = secondFactorCode(formData);
  const accepted =
    !security?.totpEnabledAt ||
    (code.success &&
      (await verifyAccountSecondFactor(db, accountId, code.data, { consumeTotpStep: false })));
  if (!accepted) redirect(noticeUrl(shopPath(shopSlug, "me", "security"), "code-invalid"));
  await disableTotp(db, accountId);
  (await cookies()).delete(RECOVERY_CODES_COOKIE);
  revalidateAndRedirect(
    shopPath(shopSlug, "me", "security"),
    noticeUrl(shopPath(shopSlug, "me", "security"), "two-factor-disabled"),
  );
}

export async function refreshRecoveryCodesAction(shopSlug: string, formData: FormData) {
  const { db, accountId } = await securityContext(shopSlug);
  if (!(await secondFactorAttemptAllowed(accountId))) {
    redirect(noticeUrl(shopPath(shopSlug, "me", "security"), "too-many-attempts"));
  }
  const key = secretKeyFromEnvironment();
  if (key.status !== "ok") {
    redirect(noticeUrl(shopPath(shopSlug, "me", "security"), "security-unavailable"));
  }
  const code = secondFactorCode(formData);
  if (!code.success) {
    redirect(noticeUrl(shopPath(shopSlug, "me", "security"), "code-invalid"));
  }

  const result = await refreshAccountRecoveryCodes(db, accountId, code.data);
  if (!result.ok) {
    redirect(
      noticeUrl(
        shopPath(shopSlug, "me", "security"),
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
      secure: runtimeMode().secureCookies,
    },
  );
  revalidateAndRedirect(shopPath(shopSlug, "me", "security"));
}

export async function revokeSessionAction(shopSlug: string, formData: FormData) {
  const { db, accountId } = await securityContext(shopSlug);
  const sessionId = parseForm(sessionIdForm, formData);
  if (!sessionId.ok) redirect(noticeUrl(shopPath(shopSlug, "me", "security"), "security-invalid"));
  await revokeAccountSession(db, accountId, sessionId.data.sessionId);
  revalidateAndRedirect(
    shopPath(shopSlug, "me", "security"),
    noticeUrl(shopPath(shopSlug, "me", "security"), "session-revoked"),
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
    redirect(noticeUrl(shopPath(shopSlug, "me", "security"), "too-many-attempts"));
  }
  const stepUp = readForm(stepUpForm, formData);
  const purposeValue = stepUp.purpose;
  const returnTo = safeStepUpReturnPath(shopSlug, stepUp.returnTo);
  const code = secondFactorCode(formData);
  if (!isStepUpPurpose(purposeValue) || !returnTo || !code.success || !session.user.sessionId) {
    redirect(noticeUrl(shopPath(shopSlug, "me", "security"), "security-invalid"));
  }
  const accepted = await verifyAccountSecondFactor(db, accountId, code.data, {
    consumeTotpStep: false,
    requireEnabled: true,
  });
  if (!accepted) {
    redirect(
      noticeUrl(shopPath(shopSlug, "me", "security"), "code-invalid", {
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
    redirect(noticeUrl(shopPath(shopSlug, "me", "security"), "security-invalid"));
  }
  redirect(returnTo);
}
