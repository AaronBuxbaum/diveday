"use server";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  beginTotpEnrollment,
  disableTotp,
  enableTotp,
  getAccountSecurity,
  grantStepUp,
  revokeAccountSession,
  revokeAllAccountSessions,
  verifyAccountSecondFactor,
} from "@/db/account-security";
import { userAccounts } from "@/db/schema";
import { revalidateAndRedirect } from "@/lib/navigation";
import { sealSecret, secretKeyFromEnvironment } from "@/lib/secret-box";
import { isStepUpPurpose, safeStepUpReturnPath } from "@/lib/security-step-up";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

const RECOVERY_CODES_COOKIE = "diveday_totp_recovery_codes";

async function securityContext(shopSlug: string) {
  const surface = await requireShopSurface(shopSlug);
  const [account] = await surface.db
    .select({ id: userAccounts.id })
    .from(userAccounts)
    .where(eq(userAccounts.personId, surface.session.user.personId))
    .limit(1);
  if (!account) redirect(noticeUrl(shopPath(shopSlug, "settings", "security"), "security-invalid"));
  return { ...surface, accountId: account.id };
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

export async function enableTotpAction(shopSlug: string, formData: FormData) {
  const { db, accountId } = await securityContext(shopSlug);
  const code = z
    .string()
    .regex(/^\d{6}$/)
    .safeParse(formData.get("code"));
  const enabled = code.success && (await enableTotp(db, accountId, code.data));
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
  const code = z.string().trim().min(6).max(32).safeParse(formData.get("code"));
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

export async function revokeSessionAction(shopSlug: string, formData: FormData) {
  const { db, accountId } = await securityContext(shopSlug);
  const sessionId = z.string().uuid().safeParse(formData.get("sessionId"));
  if (!sessionId.success)
    redirect(noticeUrl(shopPath(shopSlug, "settings", "security"), "security-invalid"));
  await revokeAccountSession(db, accountId, sessionId.data);
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
  const purposeValue = String(formData.get("purpose") ?? "");
  const returnTo = safeStepUpReturnPath(shopSlug, String(formData.get("returnTo") ?? ""));
  const code = z.string().trim().min(6).max(32).safeParse(formData.get("code"));
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
