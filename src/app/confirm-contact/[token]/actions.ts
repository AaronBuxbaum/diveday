"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { confirmShopContactEmail } from "@/db/shop-contact-email";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { shopContactEmailLinkPath } from "@/lib/shop-contact-email";

/**
 * The one mutating step: `confirmShopContactEmail` claims the token and stamps
 * the shop in a single transaction, and its claim re-checks that the shop's
 * contact email is *still* the address this link was sent to — so a link
 * requested for one inbox can never confirm a different one that was typed in
 * afterwards.
 *
 * A claim failure (expired, used, superseded, or the address moved) bounces
 * back to the same page, which re-derives an accurate notice from
 * `checkShopContactEmailToken`. No separate error flag: two ways of saying
 * "this link does not work" is one more than the reader needs.
 */
export async function confirmContactEmail(token: string) {
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("confirm-contact", ip), RATE_LIMITS.accountTokenAction))
      .allowed
  ) {
    redirect(shopContactEmailLinkPath(token));
  }
  const claimed = await confirmShopContactEmail(await getDb(), { token });
  if (!claimed) redirect(shopContactEmailLinkPath(token));
  redirect(`${shopContactEmailLinkPath(token)}?confirmed=1`);
}
