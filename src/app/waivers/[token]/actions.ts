"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { emailFreshWaiverLink, type WaiverLinkRescue } from "@/db/waiver-issue";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

/**
 * The one transactional action a dead waiver link still offers: send its owner
 * a fresh one. Nothing here hands the caller new access — the replacement link
 * goes to the address already on the booking, and only an outcome code comes
 * back to the page, so a leaked stale URL can trigger a delivery to its owner
 * and nothing more (the rules live with `emailFreshWaiverLink`).
 */

/** Outcome codes as one-word query values — the page turns each into a sentence. */
const RESCUE_PARAM: Record<WaiverLinkRescue, string> = {
  sent: "ok",
  no_email: "none",
  already_signed: "signed",
  unavailable: "unavailable",
  failed: "failed",
};

export async function emailFreshWaiverLinkAction(token: string) {
  const ip = await clientIp();
  // Two nets, because they bound different abuses: the shared per-IP waiver
  // bucket (the same one the sign/save actions on this page spend from) stops
  // one client hammering many tokens, and the per-token bucket stops many
  // clients hammering one diver's inbox with a single leaked URL.
  const allowed =
    (await checkRateLimit(rateLimitKey("waiver-token", ip), RATE_LIMITS.capabilityAction))
      .allowed &&
    (
      await checkRateLimit(
        rateLimitKey("waiver-link-resend", token),
        RATE_LIMITS.waiverLinkResendByToken,
      )
    ).allowed;
  if (!allowed) redirect(`/waivers/${token}?sent=rate`);

  const outcome = await emailFreshWaiverLink(await getDb(), token);
  redirect(`/waivers/${token}?sent=${RESCUE_PARAM[outcome]}`);
}
