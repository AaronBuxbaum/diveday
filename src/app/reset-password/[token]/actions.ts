"use server";

import { hash } from "bcryptjs";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { AuthError } from "next-auth";
import { consumeAccountToken } from "@/db/account-tokens";
import { getDb } from "@/db/client";
import { sendNotification } from "@/db/notifications";
import { getAccountContact, setAccountPassword } from "@/db/user-accounts";
import { signIn } from "@/lib/auth";
import { nowDate } from "@/lib/clock";
import { publicAppUrl } from "@/lib/notifications";
import { type PasswordConfirmErrorCode, passwordConfirmSchema } from "@/lib/onboarding";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

/**
 * Consumes the token and sets the new password atomically — a failure
 * between the two must not burn a one-time link while leaving the password
 * unchanged (security review finding) — then notifies the account of the
 * change and signs the owner straight in: the same "reset and land in the
 * shop" flow onboarding already uses, rather than bouncing back to /sign-in
 * to re-enter what was just typed.
 */
export async function submitPasswordReset(token: string, formData: FormData) {
  const base = `/reset-password/${token}`;
  const ip = await clientIp();
  if (!checkRateLimit(rateLimitKey("reset-token", ip), RATE_LIMITS.accountTokenAction).allowed) {
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
  const hashedPassword = await hash(parsed.data.password, 10);
  const claimed = await db.transaction(async (tx) => {
    const claim = await consumeAccountToken(tx, { token, purpose: "password_reset" });
    if (!claim) return null;
    await setAccountPassword(tx, claim.userAccountId, hashedPassword);
    return claim;
  });
  if (!claimed) redirect(base);

  const account = await getAccountContact(db, claimed.userAccountId);
  if (!account) redirect(base);

  // Deferred with after(), not awaited: a slow or hanging Resend call must
  // not risk timing out the sign-in response the owner is waiting on
  // (security review finding).
  const origin = publicAppUrl();
  after(async () => {
    await sendNotification(db, {
      kind: "password_changed",
      userAccountId: claimed.userAccountId,
      shopId: account.shopId,
      to: account.email,
      ownerName: account.ownerName,
      forgotPasswordUrl: origin ? new URL("/forgot-password", `${origin}/`).toString() : undefined,
      changedAt: nowDate(),
    }).catch(() => ({ status: "failed" as const }));
  });

  try {
    await signIn("credentials", {
      email: account.email,
      password: parsed.data.password,
      redirectTo: `/shop/${account.shopSlug}`,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect("/sign-in");
    }
    throw error; // Propagate NEXT_REDIRECT
  }
}
