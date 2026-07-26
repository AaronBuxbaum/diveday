"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { issueAccountToken } from "@/db/account-tokens";
import { getDb } from "@/db/client";
import { findActiveAccountByEmail } from "@/db/user-accounts";
import { resetPasswordLinkPath } from "@/lib/account-tokens";
import { notify, publicAppUrl } from "@/lib/notifications";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

const requestSchema = z.object({ email: z.string().trim().email().max(150) });

/**
 * Always redirects to the same generic confirmation, whether the email
 * matched an account or not — a password-reset request must never become an
 * oracle for which emails are registered (CR-013's "never reveal which
 * dimension tripped" rule, applied here to account existence).
 */
export async function requestPasswordReset(formData: FormData) {
  const parsed = requestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/forgot-password?sent=1");
  const email = parsed.data.email.toLowerCase();

  const ip = await clientIp();
  const byIp = checkRateLimit(
    rateLimitKey("password-reset-ip", ip),
    RATE_LIMITS.passwordResetRequestByIp,
  );
  const byEmail = checkRateLimit(
    rateLimitKey("password-reset-email", email),
    RATE_LIMITS.passwordResetRequestByEmail,
  );
  if (!byIp.allowed || !byEmail.allowed) redirect("/forgot-password?sent=1");

  const db = await getDb();
  const account = await findActiveAccountByEmail(db, email);
  const origin = publicAppUrl();
  if (account && origin) {
    const issued = await issueAccountToken(db, {
      userAccountId: account.id,
      purpose: "password_reset",
    });
    await notify({
      kind: "password_reset_request",
      userAccountId: account.id,
      tokenId: issued.tokenId,
      shopId: account.shopId,
      to: account.email,
      ownerName: account.ownerName,
      resetUrl: new URL(resetPasswordLinkPath(issued.token), `${origin}/`).toString(),
      expiresAt: issued.expiresAt,
      timezone: account.timezone,
    }).catch(() => ({ status: "failed" as const }));
  }

  redirect("/forgot-password?sent=1");
}
