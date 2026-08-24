"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { consumeAccountToken } from "@/db/account-tokens";
import { getDb } from "@/db/client";
import { activateStaffAccount, getAccountContact } from "@/db/user-accounts";
import { getAuth } from "@/lib/auth";
import { type PasswordConfirmErrorCode, passwordConfirmSchema } from "@/lib/onboarding";
import { hashPassword } from "@/lib/password-hashing";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

/**
 * Consumes the invite token and activates the account atomically — a
 * failure between the two must not burn a one-time link while leaving the
 * account stuck `invited` (mirrors submitPasswordReset's same reasoning) —
 * then signs the new staff member straight into their shop.
 */
export async function acceptStaffInvite(token: string, formData: FormData) {
  const base = `/invite/${token}`;
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("invite-token", ip), RATE_LIMITS.accountTokenAction))
      .allowed
  ) {
    redirect(base);
  }

  const parsed = passwordConfirmSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const code: PasswordConfirmErrorCode | "invalid_input" =
      (parsed.error.issues[0]?.message as PasswordConfirmErrorCode | undefined) ?? "invalid_input";
    redirect(`${base}?error=${encodeURIComponent(code)}`);
  }

  const db = await getDb();
  // Hashed before the transaction opens — bcrypt's cost factor is deliberately
  // slow, and there's no reason to hold the transaction (and its row locks)
  // open for it.
  const hashedPassword = await hashPassword(parsed.data.password);
  const claimed = await db.transaction(async (tx) => {
    const claim = await consumeAccountToken(tx, { token, purpose: "invite" });
    if (!claim) return null;
    await activateStaffAccount(tx, claim.userAccountId, hashedPassword);
    return claim;
  });
  if (!claimed) redirect(base);

  const account = await getAccountContact(db, claimed.userAccountId);
  if (!account) redirect(base);

  try {
    const auth = await getAuth();
    await auth.api.signInDiveDayCredentials({
      body: { email: account.email, password: parsed.data.password },
      headers: await headers(),
    });
  } catch (error) {
    if (error instanceof APIError) {
      redirect("/sign-in");
    }
    throw error;
  }
  redirect(`/shop/${account.shopSlug}`);
}
