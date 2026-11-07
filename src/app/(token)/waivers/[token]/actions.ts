"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { emailFreshWaiverLink, type WaiverLinkRescue } from "@/db/waiver-issue";
import {
  claimCounterLink,
  refuseLinkSignedElsewhere,
  staleWaiverRecordForToken,
  type WaiverKey,
  waiverLinkDoor,
} from "@/db/waivers";
import { revalidateAndRedirect } from "@/lib/navigation";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { counterDevice, keepCounterDevice } from "./counter-device";
import {
  autosaveWaiverDraftThrough,
  completeWaiverThrough,
  type SigningDoor,
  saveWaiverDraftThrough,
} from "./signing";

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
  const inboxKey = stale
    ? rateLimitKey("waiver-link-resend", "person", stale.personId)
    : rateLimitKey("waiver-link-resend", "token", token);
  if (!(await checkRateLimit(inboxKey, RATE_LIMITS.waiverLinkResendByBooking)).allowed) {
    redirect(`/waivers/${token}?sent=rate`);
  }

  const outcome = await emailFreshWaiverLink(db, token);
  redirect(`/waivers/${token}?sent=${RESCUE_PARAM[outcome]}`);
}

/**
 * The waiver link's own door: the per-IP waiver bucket, then what the token
 * opens (`waiverLinkDoor`): a counter tablet's link, or a release with no seat.
 * A seat's own waiver link signs nothing (issue #2743).
 */
async function tokenDoor(token: unknown, act: "save" | "sign" = "save"): Promise<SigningDoor> {
  // The bound argument is whatever the browser posts: only a string is a link.
  if (typeof token !== "string") redirect("/");
  const path = `/waivers/${token}`;
  const opened = await budgetedDoor(token);
  if (opened === "rate") redirect(`${path}?error=rate`);
  if (!opened) {
    // A Sign through a live link whose release another door signed first
    // (issue #4044): nothing is saved, the desk's trail says answers came in,
    // and the page says they were not saved.
    if (act === "sign" && (await refuseLinkSignedElsewhere(await getDb(), token)))
      redirect(`${path}?error=signed`);
    // A dead link signs nothing: the page itself then says so.
    redirect(`${path}?error=unavailable`);
  }
  return { key: opened.key, path };
}

/**
 * The door a token opens on this device, behind its throttle (issue #3985).
 * Every request first passes a coarse per-IP guard, before any read. A live
 * counter code then spends that code's own budget, so every phone on the
 * shop's Wi-Fi does not share one (issue #4064: any phone opens it). Anything
 * else (a release link, a dead code) spends the per-IP bucket. The first
 * phone to act through a counter code claims it, so only that phone is shown
 * the medical answers it saved.
 */
async function budgetedDoor(
  token: string,
  budget: "action" | "autosave" = "action",
): Promise<{ key: WaiverKey } | "rate" | null> {
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("waiver-counter-ip", ip), RATE_LIMITS.counterAddress))
      .allowed
  )
    return "rate";
  const door = await waiverLinkDoor(await getDb(), token, { device: await counterDevice() });
  const allowed =
    door?.door === "counter"
      ? await checkRateLimit(
          rateLimitKey(`waiver-${budget}`, "code", door.key.linkId),
          budget === "autosave" ? RATE_LIMITS.counterAutosave : RATE_LIMITS.capabilityAction,
        )
      : await checkRateLimit(rateLimitKey("waiver-token", ip), RATE_LIMITS.capabilityAction);
  if (!allowed.allowed) return "rate";
  if (door?.door === "counter" && !door.ownDevice) {
    const device = await claimCounterLink(await getDb(), token);
    if (device) await keepCounterDevice(token, device);
  }
  return door?.door === "counter" || door?.door === "release" ? { key: door.key } : null;
}

/**
 * **Save the draft without leaving the page** (issue #3985): what the form
 * calls as the diver finishes each step. Only a code: `closed` tells the
 * page to reload onto whatever the link now says.
 */
export async function autosaveWaiverDraftAction(
  token: string,
  formData: FormData,
): Promise<"saved" | "skipped" | "closed" | "rate"> {
  if (typeof token !== "string") return "closed";
  const opened = await budgetedDoor(token, "autosave");
  if (opened === "rate") return "rate";
  // Only a counter code saves on each step, as only its form offers it.
  if (opened?.key.kind !== "counter") return "closed";
  return autosaveWaiverDraftThrough(opened.key, formData);
}

export async function saveWaiverDraftAction(token: string, formData: FormData) {
  await saveWaiverDraftThrough(await tokenDoor(token), formData);
}

export async function completeWaiverAction(token: string, formData: FormData) {
  await completeWaiverThrough(await tokenDoor(token, "sign"), formData);
  // Always the receipt, which carries the physician instructions when
  // referred: a waiver link is authority to sign that waiver, not to open trip
  // prep. A parent signing a child's seat signs on their own link instead
  // (`completeMinorWaiver`, issue #2743), so there is nowhere else to return.
  revalidateAndRedirect(`/waivers/${token}`, `/waivers/${token}`);
}
