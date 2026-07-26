"use server";

import { hash } from "bcryptjs";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { z } from "zod";
import { consumeAccountToken } from "@/db/account-tokens";
import { getDb } from "@/db/client";
import { getAccountContact, setAccountPassword } from "@/db/user-accounts";
import { signIn } from "@/lib/auth";
import { nowDate } from "@/lib/clock";
import { notify, publicAppUrl } from "@/lib/notifications";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/onboarding";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

const resetSchema = z
  .object({
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      .max(MAX_PASSWORD_LENGTH, `Password must be at most ${MAX_PASSWORD_LENGTH} characters`),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

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

  const parsed = resetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    redirect(
      `${base}?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input")}`,
    );
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

  const origin = publicAppUrl();
  await notify({
    kind: "password_changed",
    userAccountId: claimed.userAccountId,
    shopId: account.shopId,
    to: account.email,
    ownerName: account.ownerName,
    forgotPasswordUrl: origin ? new URL("/forgot-password", `${origin}/`).toString() : undefined,
    changedAt: nowDate(),
  }).catch(() => ({ status: "failed" as const }));

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
