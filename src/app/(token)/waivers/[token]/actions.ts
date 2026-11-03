"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { emailFreshWaiverLink, type WaiverLinkRescue } from "@/db/waiver-issue";
import { staleWaiverRecordForToken } from "@/db/waivers";
import { isCounterWaiverToken } from "@/lib/counter-waiver-token";
import { revalidateAndRedirect } from "@/lib/navigation";
import { PARTY_RETURN_COOKIE, partyReturnCookiePath } from "@/lib/party-return";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { waiverReturnPath } from "./return-path";
import { completeWaiverThrough, type SigningDoor, saveWaiverDraftThrough } from "./signing";

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
  current_link_live: "live",
  unavailable: "unavailable",
  failed: "failed",
};

export async function emailFreshWaiverLinkAction(token: string) {
  const ip = await clientIp();
  // Two nets, because they bound different abuses: the shared per-IP waiver
  // bucket (the same one the sign/save actions on this page spend from) stops
  // one client hammering many tokens, and the narrow bucket below stops many
  // clients hammering one diver's inbox.
  if (
    !(await checkRateLimit(rateLimitKey("waiver-token", ip), RATE_LIMITS.capabilityAction)).allowed
  ) {
    redirect(`/waivers/${token}?sent=rate`);
  }

  const db = await getDb();
  // The narrow bucket belongs to the **inbox**, so it is keyed by the booking
  // the stale link resolves to — not by the URL. A booking accumulates a new
  // dead token every time a link is reissued, and keying by token handed each
  // of those N leaked URLs its own full 5/hr budget: one holder with a handful
  // of old links could still spray the same mailbox N×5 times an hour. Keyed by
  // booking, every link that was ever issued for it spends from one budget.
  // A token that resolves to nothing has no inbox to protect and no booking to
  // key on, so it falls back to itself and is otherwise stopped by the per-IP
  // net above and by the `unavailable` outcome. `rateLimitKey` hashes whichever
  // it is, so neither a raw bearer token nor a booking id is ever held as a
  // literal key.
  const stale = await staleWaiverRecordForToken(db, token);
  const inboxKey = stale?.bookingId
    ? rateLimitKey("waiver-link-resend", "booking", stale.bookingId)
    : rateLimitKey("waiver-link-resend", "token", token);
  if (!(await checkRateLimit(inboxKey, RATE_LIMITS.waiverLinkResendByBooking)).allowed) {
    redirect(`/waivers/${token}?sent=rate`);
  }

  const outcome = await emailFreshWaiverLink(db, token);
  redirect(`/waivers/${token}?sent=${RESCUE_PARAM[outcome]}`);
}

/** The waiver link's own door: the per-IP waiver bucket, then the token is the authority. */
async function tokenDoor(token: string): Promise<SigningDoor> {
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("waiver-token", ip), RATE_LIMITS.capabilityAction)).allowed
  ) {
    redirect(`/waivers/${token}?error=rate`);
  }
  return { key: token, path: `/waivers/${token}` };
}

export async function saveWaiverDraftAction(token: string, formData: FormData) {
  await saveWaiverDraftThrough(await tokenDoor(token), formData);
}

export async function completeWaiverAction(token: string, formData: FormData) {
  const { record, status } = await completeWaiverThrough(await tokenDoor(token), formData);
  // A waiver link is authority to sign that waiver, not to issue trip prep access.
  if (isCounterWaiverToken(token)) revalidateAndRedirect(`/waivers/${token}`, `/waivers/${token}`);
  // Show the mandatory physician instructions on the waiver receipt first.
  if (status === "medical_review") revalidateAndRedirect(`/waivers/${token}`, `/waivers/${token}`);
  // A parent who opened this from their party panel goes back to it, so the
  // next child's release is one tap away (dive-domain review F6).
  const jar = await cookies();
  const partyToken = jar.get(PARTY_RETURN_COOKIE)?.value;
  if (partyToken) jar.delete({ name: PARTY_RETURN_COOKIE, path: partyReturnCookiePath(token) });
  const returnPath =
    record.bookingId && partyToken
      ? await waiverReturnPath(await getDb(), {
          shopId: record.shopId,
          bookingId: record.bookingId,
          partyToken,
        })
      : null;
  if (returnPath) revalidateAndRedirect(`/waivers/${token}`, returnPath);
  revalidateAndRedirect(`/waivers/${token}`, `/waivers/${token}`);
}
