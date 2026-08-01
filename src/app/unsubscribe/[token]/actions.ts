"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { optOutPersonFromCourtesyEmailByToken } from "@/db/courtesy-email";
import { unsubscribeLastMinuteListEntryByToken } from "@/db/last-minute-list";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

/**
 * The one mutating step: resolves the token and unsubscribes whatever it
 * names — a last-minute-list entry or, failing that, a person's courtesy
 * email (the page tries the same two resolvers in the same order). Redirects
 * back to the same page either way — an invalid/unknown token and a
 * successful unsubscribe both re-render from a fresh DB read, never from a
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
  const lastMinute = await unsubscribeLastMinuteListEntryByToken(db, { token });
  if (!lastMinute) {
    await optOutPersonFromCourtesyEmailByToken(db, { token });
  }
  redirect(`/unsubscribe/${token}`);
}
