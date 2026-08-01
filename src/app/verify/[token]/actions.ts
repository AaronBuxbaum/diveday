"use server";

import { redirect } from "next/navigation";
import { consumeAccountToken } from "@/db/account-tokens";
import { getDb } from "@/db/client";
import { markEmailVerified } from "@/db/user-accounts";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

/**
 * The one mutating step: atomically claims the token and marks the account
 * verified in the same transaction, so a failure between the two can never
 * burn the one-time link without the account actually ending up verified
 * (security review finding). A claim failure (expired, already used,
 * unknown) bounces back to the same page, which re-derives an accurate "not
 * valid" notice from `checkAccountToken` — no separate error flag needed.
 */
export async function confirmEmailVerification(token: string) {
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("verify-token", ip), RATE_LIMITS.accountTokenAction))
      .allowed
  ) {
    redirect(`/verify/${token}`);
  }
  const db = await getDb();
  const claimed = await db.transaction(async (tx) => {
    const claim = await consumeAccountToken(tx, { token, purpose: "email_verification" });
    if (!claim) return null;
    await markEmailVerified(tx, claim.userAccountId);
    return claim;
  });
  if (!claimed) redirect(`/verify/${token}`);
  redirect(`/verify/${token}?confirmed=1`);
}
