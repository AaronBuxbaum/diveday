"use server";

import { redirect } from "next/navigation";
import { stopBookkeeperByToken } from "@/db/bookkeeper";
import { getDb } from "@/db/client";
import { optOutPersonFromCourtesyEmailByToken } from "@/db/courtesy-email";
import { unsubscribeAnytimeInterestByToken } from "@/db/interests";
import { stopShoreAlertsByToken } from "@/db/shore-alert-tokens";
import { turnOffWeeklyDigestByToken } from "@/db/weekly-digest";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

/**
 * The one mutating step: resolves the token and unsubscribes whatever it
 * names — a last-minute-list interest (an anytime interest) or, failing that, a person's courtesy
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
  const lastMinute = await unsubscribeAnytimeInterestByToken(db, { token });
  if (!lastMinute) {
    const courtesy = await optOutPersonFromCourtesyEmailByToken(db, { token });
    // The third kind: a staffer's own Monday email. The fourth: a shop's
    // shore contact stopping its roll-call alerts (H-20261014-stale-roll-call-recipients). The fifth, tried
    // last: a shop's bookkeeper stopping the month-end files (item 35, N1).
    const digest = courtesy ? null : await turnOffWeeklyDigestByToken(db, { token });
    const shore = courtesy || digest ? null : await stopShoreAlertsByToken(db, { token });
    if (!courtesy && !digest && !shore) await stopBookkeeperByToken(db, { token });
  }
  redirect(`/unsubscribe/${token}`);
}
