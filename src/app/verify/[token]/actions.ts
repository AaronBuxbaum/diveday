"use server";

import { redirect } from "next/navigation";
import { consumeAccountToken } from "@/db/account-tokens";
import { getDb } from "@/db/client";
import { markEmailVerified } from "@/db/user-accounts";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

/**
 * The one mutating step: atomically claims the token, then marks the account
 * verified. A claim failure (expired, already used, unknown) bounces back to
 * the same page, which re-derives an accurate "not valid" notice from
 * `checkAccountToken` — no separate error flag needed.
 */
export async function confirmEmailVerification(token: string) {
  const ip = await clientIp();
  if (!checkRateLimit(rateLimitKey("verify-token", ip), RATE_LIMITS.accountTokenAction).allowed) {
    redirect(`/verify/${token}`);
  }
  const db = await getDb();
  const claimed = await consumeAccountToken(db, { token, purpose: "email_verification" });
  if (!claimed) redirect(`/verify/${token}`);
  await markEmailVerified(db, claimed.userAccountId);
  redirect(`/verify/${token}?confirmed=1`);
}
