"use server";

import { redirect } from "next/navigation";
import { openWaiverInThread, threadWaiverKey } from "@/db/waivers";
import { revalidateAndRedirect } from "@/features/navigation";
import type { DoctorAnswersState, DoctorFormState } from "../../waivers/[token]/doctor/doctor-core";
import {
  revealDoctorAnswersFor,
  sendDoctorFormFor,
} from "../../waivers/[token]/doctor/doctor-core";
import {
  completeWaiverThrough,
  type SigningDoor,
  saveWaiverDraftThrough,
} from "../../waivers/[token]/signing";
import { base, bounceTarget, contextFor, refuseWhileHeld } from "./action-helpers";

/**
 * **The release is the thread's Sign step, not a second link** (issue #2743).
 *
 * The diver signs on their own readiness link, at `/ready/<token>/waiver`: the
 * same form the waiver link draws (`waiverSigningForm`), reached by the
 * credential they already hold. No waiver token is handed to them and no
 * cookie carries them back; the readiness link is the whole authority, checked
 * on every act by `contextFor` (per-IP bucket, live capability, a seat that is
 * not cancelled) and `refuseWhileHeld`.
 *
 * Every act resolves the record from that verified capability
 * (`threadWaiverKey`), never from anything the browser sent: the only argument
 * bound into the page is the readiness token itself.
 */

const waiverPath = (token: string) => `${base(token)}/waiver`;

/**
 * The seat's own release, through the verified readiness link; a bounce
 * otherwise. `drawnRecordId` is the release the page drew: it grants nothing
 * (the key still comes from the capability), but a signature lands only on
 * the words the diver read. If the seat's release has changed since (a staff
 * resend on new terms, the Sign step tapped in another tab), the page draws
 * the current one again instead (records review of #2743, F1).
 */
async function threadDoor(token: string, drawnRecordId: unknown): Promise<SigningDoor> {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  refuseWhileHeld(token, ctx.data);
  const key = await threadWaiverKey(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
  });
  if (!key) redirect(base(token));
  if (key.recordId !== drawnRecordId) redirect(waiverPath(token));
  return { key, path: waiverPath(token) };
}

/**
 * **Sign your waiver**, from the thread's Sign step. Keeps the release the seat
 * already has when it can still be signed on the shop's current terms (and the
 * draft typed into it), or starts a fresh one when it has expired, lapsed, or
 * needs a guardian's signature beside the diver's; then opens it on this link.
 */
export async function openWaiverFromReady(token: string) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  refuseWhileHeld(token, ctx.data);
  const opened = await openWaiverInThread(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    // The holder and departure this request read: a seat moved since refuses.
    expectedPersonId: ctx.data.person.id,
    expectedTripId: ctx.data.detail.trip.id,
  });
  if (!opened.ok) redirect(`${base(token)}?error=waiver`);
  redirect(waiverPath(token));
}

export async function saveWaiverDraftFromReady(
  token: string,
  drawnRecordId: string,
  formData: FormData,
) {
  await saveWaiverDraftThrough(await threadDoor(token, drawnRecordId), formData);
}

/**
 * Sign, then back to the checklist with the step done. A referred signer lands
 * on the release's receipt instead, which carries the physician instructions
 * and the doctor's page, as the waiver link's receipt does.
 */
export async function completeWaiverFromReady(
  token: string,
  drawnRecordId: string,
  formData: FormData,
) {
  const { status } = await completeWaiverThrough(await threadDoor(token, drawnRecordId), formData);
  if (status === "medical_review") revalidateAndRedirect(waiverPath(token), waiverPath(token));
  revalidateAndRedirect(base(token), `${base(token)}?saved=waiver`);
}

/** The thread's per-IP bucket and capability, then the record from that capability. */
async function threadDoctorKey(token: string) {
  const ctx = await contextFor(token);
  if (!ctx.ok) return ctx.reason === "rate_limited" ? "rate" : null;
  if (ctx.data.identityHeld) return null;
  return threadWaiverKey(ctx.db, { shopId: ctx.data.shop.id, bookingId: ctx.bookingId });
}

/** The doctor's page's unlock, on the diver's own link (`revealDoctorAnswersAction`'s twin). */
export async function revealDoctorAnswersFromReady(
  token: string,
  _previous: DoctorAnswersState,
  formData: FormData,
): Promise<DoctorAnswersState> {
  const key = await threadDoctorKey(token);
  if (key === "rate") return { status: "rate" };
  if (!key) return { status: "closed" };
  return revealDoctorAnswersFor(key, formData);
}

/** The doctor's form, sent from the diver's own link (`sendDoctorFormAction`'s twin). */
export async function sendDoctorFormFromReady(
  token: string,
  _previous: DoctorFormState,
  formData: FormData,
): Promise<DoctorFormState> {
  const key = await threadDoctorKey(token);
  if (key === "rate") return { status: "rate" };
  if (!key) return { status: "closed" };
  return sendDoctorFormFor(key, formData);
}
