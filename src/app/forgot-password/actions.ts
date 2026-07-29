"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { issueAccountToken } from "@/db/account-tokens";
import { getDb } from "@/db/client";
import { sendNotification } from "@/db/notifications";
import { findActiveAccountByEmail } from "@/db/user-accounts";
import { resetPasswordLinkPath } from "@/lib/account-tokens";
import { publicAppUrl } from "@/lib/notifications";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

const requestSchema = z.object({ email: z.string().trim().email().max(150) });

/**
 * Always redirects to the same generic confirmation, whether the email
 * matched an account or not — a password-reset request must never become an
 * oracle for which emails are registered (CR-013's "never reveal which
 * dimension tripped" rule, applied here to account existence). That has to
 * hold for response *time*, not just response content: issuing a token and
 * awaiting a Resend network call only on the matched branch would make a
 * matched request measurably slower than an unmatched one, reopening the
 * oracle as a timing side-channel a security review found. `after()` defers
 * that work past the response instead — both branches redirect on the same
 * single indexed lookup, and the deferred work still runs to completion
 * (unlike a bare unawaited promise, which a serverless runtime can kill).
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
    after(async () => {
      const issued = await issueAccountToken(db, {
        userAccountId: account.id,
        purpose: "password_reset",
      });
      await sendNotification(db, {
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
    });
  }

  redirect("/forgot-password?sent=1");
}
