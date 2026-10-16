"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { optOutPersonFromCourtesyEmailByToken } from "@/db/courtesy-email";
import { unsubscribeLastMinuteListEntryByToken } from "@/db/last-minute-list";
import { stopShoreAlertsByToken } from "@/db/shore-alert-tokens";
import { turnOffWeeklyDigestByToken } from "@/db/weekly-digest";
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
    !(await checkRateLimit(rateLimitKey("unsubscribe-token", ip), RATE_LIMITS.accountTokenAction))
      .allowed
  ) {
    redirect(`/unsubscribe/${token}`);
  }
  const db = await getDb();
  const lastMinute = await unsubscribeLastMinuteListEntryByToken(db, { token });
  if (!lastMinute) {
    const courtesy = await optOutPersonFromCourtesyEmailByToken(db, { token });
    // The third kind: a staffer's own Monday email. The fourth, tried last:
    // a shop's shore contact stopping its roll-call alerts (H-118).
    const digest = courtesy ? null : await turnOffWeeklyDigestByToken(db, { token });
    if (!courtesy && !digest) await stopShoreAlertsByToken(db, { token });
  }
  redirect(`/unsubscribe/${token}`);
}
