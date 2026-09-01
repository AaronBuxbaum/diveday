"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { closeDay, recordLeftoverDecision } from "@/db/closeout";
import { updateHelpRequestStatus } from "@/db/help-requests";
import { queueAndAttemptMediaDeletion } from "@/db/media-deletions";
import {
  addCrewRecapPhoto,
  canAddCrewRecapPhoto,
  deleteCrewRecapPhoto,
  deleteRecapPhoto,
  hasSentTripRecap,
  pauseTripRecapAutoSend,
  sendTripRecaps,
  setTripRecapShoutout,
  unpauseTripRecapAutoSend,
} from "@/db/recap";
import { getShopById } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { canViewShopReports } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { type LeftoverDecision, shopDayOf } from "@/lib/closeout";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { deleteStoredImage, storeRecapImage } from "@/lib/storage";
import { uuidParam } from "@/lib/uuid";

/**
 * **The shop home's evening acts** (ADR 20260827-clearwater-surface-language,
 * decision 4; H-62).
 *
 * Every one of these used to be an inline closure on `/close-out/page.tsx`.
 * That route is a 308 now — the evening is a state the home's spine settles
 * into, not a second surface — so the acts moved with it, into the sibling
 * `actions.ts` AGENTS.md asks of a large page rather than back onto a 700-line
 * component.
 *
 * They are module-level rather than closures because two components bind them:
 * a settled station binds the recap acts, and the closing block binds the
 * leftover and close acts. None of them takes a shop from its caller — every
 * one resolves the tenant from the session, which is what makes them safe to
 * bind anywhere.
 */

/** Where every act below lands: the home, which is now the evening's own page. */
async function shopHome() {
  const staff = await requireStaffSession();
  return { staff, home: shopPath(staff.user.shopSlug) };
}

/** Move one diver's day-of request through the visible shop hand-off. */
export async function updateHelpRequestAction(
  requestId: string,
  status: "acknowledged" | "handled",
) {
  const { staff, home } = await shopHome();
  if (!uuidParam(requestId) || (status !== "acknowledged" && status !== "handled")) redirect(home);
  const result = await updateHelpRequestStatus(await getDb(), {
    shopId: staff.user.shopId,
    requestId,
    status,
    actorPersonId: staff.user.personId,
  });
  if (!result.ok) redirect(home);
  revalidateAndRedirect(home, home);
}

/**
 * Close the day.
 *
 * **Nothing stands in front of this** — no confirm, no acknowledgement
 * checkbox, no caption explaining what closing means. The old surface asked a
 * staffer to tick "I have seen the open head count" before it would record the
 * act; H-57 had already decided that leftovers are decided per row as they are
 * met, so the checkbox re-asked an answered question on a reversible act
 * (principle 7). The snapshot still records everything that was open, computed
 * at the moment of closing from the source of truth rather than from anything
 * the form claimed.
 */
export async function closeDayAction() {
  const staff = await requireStaffSession();
  const actionDb = await getDb();
  const actionShop = await getShopById(actionDb, staff.user.shopId);
  if (!actionShop) redirect(shopPath(staff.user.shopSlug));
  const actionLocale = await requestLocale(actionShop.defaultLocale);
  const home = shopPath(staff.user.shopSlug);
  await closeDay(actionDb, {
    shopId: actionShop.id,
    shopSlug: staff.user.shopSlug,
    timeZone: actionShop.timezone,
    actorPersonId: staff.user.personId,
    // Per-row choices are persisted as soon as they are tapped. Keeping this
    // final act choice-free means a stale tab cannot overwrite a newer one.
    decisions: {},
    t: staffTranslator(actionLocale),
    locale: actionLocale,
    includeOpsAlerts: canViewShopReports(staff.user.roles),
  });
  revalidateAndRedirect(`${home}?closed=1`);
}

/** Persist one row's choice immediately; Undo appends the inverse choice. */
export async function setLeftoverDecisionAction(
  actionId: string,
  decisionToWrite: LeftoverDecision,
) {
  const staff = await requireStaffSession();
  const actionDb = await getDb();
  const actionShop = await getShopById(actionDb, staff.user.shopId);
  if (!actionShop) redirect(shopPath(staff.user.shopSlug));
  const decidedAt = nowDate();
  await recordLeftoverDecision(actionDb, {
    shopId: actionShop.id,
    shopDay: shopDayOf(decidedAt, actionShop.timezone),
    actionId,
    decision: decisionToWrite,
    actorPersonId: staff.user.personId,
    decidedAt,
  });
  const home = shopPath(staff.user.shopSlug);
  revalidateAndRedirect(
    home,
    `${home}?decision=${encodeURIComponent(actionId)}&decisionState=${decisionToWrite}`,
  );
}

/**
 * Save one departure's post-trip recap note, from its own station. Every staff
 * role may write one, the same rule as closing the day itself: whoever came
 * back with the boat is who remembers the dive. `?noted=<tripId>` is what
 * re-opens that station's editor with its confirmation after the redirect — a
 * page-level banner would answer a question asked six stations down.
 */
export async function saveRecapNoteAction(tripId: string, formData: FormData) {
  const { staff, home } = await shopHome();
  const actionDb = await getDb();
  if (await hasSentTripRecap(actionDb, staff.user.shopId, tripId)) {
    revalidateAndRedirect(home, noticeUrl(home, "recap-locked", { noted: tripId }));
  }
  const note = String(formData.get("recapShoutout") ?? "").slice(0, 400);
  await setTripRecapShoutout(actionDb, staff.user.shopId, tripId, note);
  revalidateAndRedirect(home, `${home}?noted=${encodeURIComponent(tripId)}`);
}

export async function deleteRecapPhotoAction(tripId: string, formData: FormData) {
  const { staff, home } = await shopHome();
  const photoId = String(formData.get("photoId") ?? "");
  if (!photoId) redirect(home);
  const db = await getDb();
  if (await hasSentTripRecap(db, staff.user.shopId, tripId)) redirect(home);
  const result = await deleteRecapPhoto(db, staff.user.shopId, photoId);
  if (result.deleted) {
    await queueAndAttemptMediaDeletion(db, {
      shopId: staff.user.shopId,
      kind: "recap_photo",
      url: result.imageUrl,
    });
  }
  revalidateAndRedirect(
    home,
    `${home}?notice=recap-photo-removed&noted=${encodeURIComponent(tripId)}`,
  );
}

/** Store a staff image on the departure and share it with every diver recap. */
export async function uploadCrewRecapPhotoAction(tripId: string, formData: FormData) {
  const { staff, home } = await shopHome();
  const db = await getDb();
  if (await hasSentTripRecap(db, staff.user.shopId, tripId)) {
    revalidateAndRedirect(home, noticeUrl(home, "recap-locked", { noted: tripId }));
  }
  const file = formData.get("crewPhoto");
  if (!(file instanceof File) || file.size === 0) {
    revalidateAndRedirect(home, noticeUrl(home, "crew-photo-failed", { noted: tripId }));
  }
  const eligibility = await canAddCrewRecapPhoto(db, {
    shopId: staff.user.shopId,
    tripId,
    uploadedByPersonId: staff.user.personId,
  });
  if (!eligibility.ok) {
    const notice = eligibility.reason === "limit" ? "crew-photo-limit" : "invalid";
    revalidateAndRedirect(home, noticeUrl(home, notice, { noted: tripId }));
  }
  const stored = await storeRecapImage({
    filename: file.name,
    contentType: file.type,
    bytes: await file.arrayBuffer(),
  });
  if (stored.status !== "stored") {
    revalidateAndRedirect(
      home,
      noticeUrl(
        home,
        stored.status === "not_configured" ? "crew-photo-unconfigured" : "crew-photo-failed",
        { noted: tripId },
      ),
    );
  }
  const result = await addCrewRecapPhoto(db, {
    shopId: staff.user.shopId,
    tripId,
    uploadedByPersonId: staff.user.personId,
    imageUrl: stored.url,
  });
  if (!result.ok) {
    await deleteStoredImage(stored.url);
    const notice = result.reason === "limit" ? "crew-photo-limit" : "crew-photo-failed";
    revalidateAndRedirect(home, noticeUrl(home, notice, { noted: tripId }));
  }
  revalidateAndRedirect(home, noticeUrl(home, "crew-photo-added", { noted: tripId }));
}

export async function deleteCrewRecapPhotoAction(tripId: string, formData: FormData) {
  const { staff, home } = await shopHome();
  const photoId = String(formData.get("photoId") ?? "");
  if (!photoId) redirect(home);
  const db = await getDb();
  if (await hasSentTripRecap(db, staff.user.shopId, tripId)) redirect(home);
  const result = await deleteCrewRecapPhoto(db, staff.user.shopId, photoId);
  if (result.deleted) {
    await queueAndAttemptMediaDeletion(db, {
      shopId: staff.user.shopId,
      kind: "recap_photo",
      url: result.imageUrl,
    });
  }
  revalidateAndRedirect(home, noticeUrl(home, "crew-photo-removed", { noted: tripId }));
}

/**
 * A staff send for one returned departure. Staff can send the recap whenever
 * they want once the departure has ended.
 */
export async function sendRecapAction(tripId: string) {
  const { staff, home } = await shopHome();
  const result = await sendTripRecaps(await getDb(), { shopId: staff.user.shopId, tripId });
  if (!result.ok) revalidateAndRedirect(home, noticeUrl(home, "invalid"));
  revalidateAndRedirect(
    home,
    noticeUrl(home, result.summary.failed > 0 ? "recap-send-attention" : "recap-sent"),
  );
}

export async function toggleRecapAutoSendPauseAction(formData: FormData) {
  const { staff, home } = await shopHome();
  const tripId = String(formData.get("tripId") ?? "");
  const paused = formData.get("paused") === "true";
  if (!tripId) redirect(home);
  const db = await getDb();
  if (paused) {
    await pauseTripRecapAutoSend(db, staff.user.shopId, tripId);
  } else {
    await unpauseTripRecapAutoSend(db, staff.user.shopId, tripId);
  }
  revalidateAndRedirect(home);
}
