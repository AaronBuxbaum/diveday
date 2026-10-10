"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { fitAdjustedReturnTeaching } from "@/db/gear";
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
import { confirmRentalFitSize } from "@/db/rental-fit";
import { parseForm } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { deleteStoredImage, storeRecapImage } from "@/lib/storage";
import { uuidParam } from "@/lib/uuid";

/**
 * **The shop home's evening acts** (ADR 20260827-clearwater-surface-language,
 * decision 4; H-62).
 *
 * The evening is a state the home's spine settles into, not a second surface,
 * so its acts live in the sibling `actions.ts` AGENTS.md asks of a large page
 * rather than on a 700-line component.
 *
 * They are module-level rather than closures because a settled station binds
 * the recap acts. None of them takes a shop from its caller — every one
 * resolves the tenant from the session, which is what makes them safe to bind
 * anywhere.
 */

/** The evening acts' forms, read through one parser (issue #2233). */
const recapNoteForm = z.object({ recapShoutout: z.string().default("") });
const photoForm = z.object({ photoId: z.string().default("") });
const crewPhotoForm = z.object({ crewPhoto: z.instanceof(File).refine((file) => file.size > 0) });
const recapPauseForm = z.object({
  tripId: z.string().default(""),
  paused: z.string().optional(),
});

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
 * Save one departure's post-trip recap note, from its own station. Every staff
 * role may write one: whoever came back with the boat is who remembers the
 * dive. `?noted=<tripId>` is what
 * re-opens that station's editor with its confirmation after the redirect — a
 * page-level banner would answer a question asked six stations down.
 */
export async function saveRecapNoteAction(tripId: string, formData: FormData) {
  const { staff, home } = await shopHome();
  const actionDb = await getDb();
  if (await hasSentTripRecap(actionDb, staff.user.shopId, tripId)) {
    revalidateAndRedirect(home, noticeUrl(home, "recap-locked", { noted: tripId }));
  }
  const parsed = parseForm(recapNoteForm, formData);
  if (!parsed.ok) revalidateAndRedirect(home, noticeUrl(home, "invalid", { noted: tripId }));
  const note = parsed.data.recapShoutout.slice(0, 400);
  await setTripRecapShoutout(actionDb, staff.user.shopId, tripId, note);
  revalidateAndRedirect(home, `${home}?noted=${encodeURIComponent(tripId)}`);
}

export async function deleteRecapPhotoAction(tripId: string, formData: FormData) {
  const { staff, home } = await shopHome();
  const parsed = parseForm(photoForm, formData);
  if (!parsed.ok || !parsed.data.photoId) redirect(home);
  const { photoId } = parsed.data;
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
  const parsed = parseForm(crewPhotoForm, formData);
  if (!parsed.ok) {
    revalidateAndRedirect(home, noticeUrl(home, "crew-photo-failed", { noted: tripId }));
  }
  const file = parsed.data.crewPhoto;
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
  const parsed = parseForm(photoForm, formData);
  if (!parsed.ok || !parsed.data.photoId) redirect(home);
  const { photoId } = parsed.data;
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
  // Somebody on the boat is still "not back aboard" (#2123): nothing went out,
  // and the staffer is told why rather than that it failed.
  if (!result.ok && result.reason === "held") {
    revalidateAndRedirect(home, noticeUrl(home, "recap-held"));
  }
  if (!result.ok) revalidateAndRedirect(home, noticeUrl(home, "invalid"));
  revalidateAndRedirect(
    home,
    noticeUrl(home, result.summary.failed > 0 ? "recap-send-attention" : "recap-sent"),
  );
}

/**
 * **Keep the size a unit actually went out in** (issue #1174, delight report
 * D14) — the evening's one-tap answer, from the leftovers group.
 *
 * Every staff role may answer it, the same rule as closing the day: whoever
 * was at the counter when the swap happened is who knows. That is only true
 * because the tap writes down what a human already decided rather than making
 * a new call — and until a `security-reviewer` pass read this next door to the
 * guardian layer, nothing made it true. The action took the *size* as an
 * argument, so a crew member could post any person id in their shop with any
 * string and rewrite that diver's stated fit, which is the act
 * `canOverrideGearRequest` reserves for owner, manager, instructor and
 * divemaster.
 *
 * So the tap names the reservation and nothing else. `fitAdjustedReturnTeaching`
 * re-proves the desk's own `fit_adjusted` return, shop-scoped, and hands back
 * the person, the kind and the size; a caller who invents an id gets `invalid`
 * and writes nothing.
 */
export async function keepRentalFitAction(reservationId: string) {
  const { staff, home } = await shopHome();
  if (!uuidParam(reservationId)) redirect(home);
  const db = await getDb();
  const teaching = await fitAdjustedReturnTeaching(db, {
    shopId: staff.user.shopId,
    reservationId,
  });
  if (!teaching) revalidateAndRedirect(home, noticeUrl(home, "invalid"));
  const result = await confirmRentalFitSize(db, {
    shopId: staff.user.shopId,
    personId: teaching.personId,
    kind: teaching.kind,
    size: teaching.size,
    confirmedByPersonId: staff.user.personId,
  });
  if (result !== "saved") revalidateAndRedirect(home, noticeUrl(home, result));
  // No notice on the way back. The row leaving the leftovers group is the
  // answer, and a banner reading "Fit saved." over three of those rows told a
  // staffer who tapped two in a row nothing about which one landed (#1400).
  revalidateAndRedirect(home);
}

export async function toggleRecapAutoSendPauseAction(formData: FormData) {
  const { staff, home } = await shopHome();
  const parsed = parseForm(recapPauseForm, formData);
  if (!parsed.ok || !parsed.data.tripId) redirect(home);
  const { tripId } = parsed.data;
  const paused = parsed.data.paused === "true";
  const db = await getDb();
  if (paused) {
    await pauseTripRecapAutoSend(db, staff.user.shopId, tripId);
  } else {
    await unpauseTripRecapAutoSend(db, staff.user.shopId, tripId);
  }
  revalidateAndRedirect(home);
}
