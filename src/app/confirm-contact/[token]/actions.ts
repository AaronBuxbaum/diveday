"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { consumeShopContactEmailConfirmation } from "@/db/shop-contact-email";
import { consumeShoreAlertConfirmation } from "@/db/shore-alert-tokens";
import { confirmContactLinkPath } from "@/lib/contact-email-confirmation";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

/**
 * The one mutating step: claims the token and stamps the address confirmed in
 * one transaction (`consumeShopContactEmailConfirmation`), which also
 * re-checks that the shop still names the token's address. Every outcome
 * redirects back to the same page, which re-derives its state from the
 * database -- a spent token reads as confirmed, a stale one as unavailable --
 * so nothing here can be forged into a false success.
 */
export async function confirmContactEmail(token: string) {
  const ip = await clientIp();
  if (
    !(
      await checkRateLimit(
        rateLimitKey("confirm-contact-token", ip),
        RATE_LIMITS.accountTokenAction,
      )
    ).allowed
  ) {
    redirect(confirmContactLinkPath(token));
  }
  const db = await getDb();
  // Two token kinds, tried in turn as the page does: the front desk's, then
  // the shore contact's (H-118). Each hash lives in its own table.
  if (!(await consumeShopContactEmailConfirmation(db, { token }))) {
    await consumeShoreAlertConfirmation(db, { token });
  }
  redirect(confirmContactLinkPath(token));
}
