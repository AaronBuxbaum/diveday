"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { unsubscribeLastMinuteListEntryByToken } from "@/db/last-minute-list";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

/**
 * The one mutating step: resolves the token and unsubscribes the entry it
 * names. Redirects back to the same page either way — an invalid/unknown
 * token and a successful unsubscribe both re-render from a fresh DB read
 * (`resolveLastMinuteListUnsubscribeToken` in the page), never from a
 * caller-controlled query flag, so nothing here can be forged into a false
 * confirmation.
 */
export async function confirmUnsubscribe(token: string) {
  const ip = await clientIp();
  if (
    !checkRateLimit(rateLimitKey("unsubscribe-token", ip), RATE_LIMITS.accountTokenAction).allowed
  ) {
    redirect(`/unsubscribe/${token}`);
  }
  const db = await getDb();
  await unsubscribeLastMinuteListEntryByToken(db, { token });
  redirect(`/unsubscribe/${token}`);
}
