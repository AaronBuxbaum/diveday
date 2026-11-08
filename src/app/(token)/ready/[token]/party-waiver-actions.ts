"use server";

import { redirect } from "next/navigation";
import { revalidateAndRedirect } from "@/features/navigation";
import { partySeatWaiverKey } from "@/features/seat-claims";
import { uuidParam } from "@/lib/uuid";
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
import {
  base,
  bounceTarget,
  contextFor,
  partySeatWaiverPath,
  refuseWhileHeld,
} from "./action-helpers";

/**
 * **A party lead signs a child's release on their own link** (issue #2743,
 * H-20261014-parent-signs-minor-release). The lead's readiness link is the
 * whole authority, checked on every act by `contextFor` and
 * `refuseWhileHeld`; the seat id in the URL only says which of the lead's
 * seats, and `partySeatWaiverKey` re-reads that the panel's door on it is
 * still open. No waiver link and no cookie: the lead never leaves their own
 * link, and lands back on their party panel once it is signed.
 */

const panel = (token: string) => `${base(token)}#party-seats`;

/** The lead's key to the seat's release, or a bounce to the lead's panel. */
async function seatKey(token: string, seatBookingId: unknown) {
  if (typeof seatBookingId !== "string" || !uuidParam(seatBookingId)) redirect(panel(token));
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  refuseWhileHeld(token, ctx.data);
  const opened = await partySeatWaiverKey(ctx.db, {
    shopId: ctx.data.shop.id,
    leadBookingId: ctx.bookingId,
    seatBookingId,
  });
  if (!opened) redirect(panel(token));
  return { ...opened, path: partySeatWaiverPath(token, seatBookingId) };
}

/**
 * The signing door: only while a parent's signature is owed (`sign`), and
 * only on the release the page drew, so a signature lands on the words read
 * (records review of #2743, F1).
 */
async function signDoor(
  token: string,
  seatBookingId: unknown,
  drawnRecordId: unknown,
): Promise<SigningDoor> {
  const { door, key, path } = await seatKey(token, seatBookingId);
  if (door !== "sign") redirect(path);
  if (key.recordId !== drawnRecordId) redirect(path);
  return { key, path };
}

export async function saveMinorWaiverDraft(
  token: string,
  seatBookingId: string,
  drawnRecordId: string,
  formData: FormData,
) {
  await saveWaiverDraftThrough(await signDoor(token, seatBookingId, drawnRecordId), formData);
}

/**
 * Sign, then back to the lead's party panel, so the next child is one tap
 * away. A referral lands on the release's receipt first, which carries the
 * physician instructions and the doctor's page.
 */
export async function completeMinorWaiver(
  token: string,
  seatBookingId: string,
  drawnRecordId: string,
  formData: FormData,
) {
  const door = await signDoor(token, seatBookingId, drawnRecordId);
  const { status } = await completeWaiverThrough(door, formData);
  if (status === "medical_review") revalidateAndRedirect(door.path, door.path);
  revalidateAndRedirect(base(token), panel(token));
}

/** The doctor's page's key: only once the parent's signature sent it to a physician. */
async function doctorKey(token: string, seatBookingId: string) {
  if (!uuidParam(seatBookingId)) return null;
  const ctx = await contextFor(token);
  if (!ctx.ok) return ctx.reason === "rate_limited" ? "rate" : null;
  if (ctx.data.identityHeld) return null;
  const opened = await partySeatWaiverKey(ctx.db, {
    shopId: ctx.data.shop.id,
    leadBookingId: ctx.bookingId,
    seatBookingId,
  });
  return opened?.door === "physician" ? opened.key : null;
}

export async function revealMinorDoctorAnswers(
  token: string,
  seatBookingId: string,
  _previous: DoctorAnswersState,
  formData: FormData,
): Promise<DoctorAnswersState> {
  const key = await doctorKey(token, seatBookingId);
  if (key === "rate") return { status: "rate" };
  if (!key) return { status: "closed" };
  return revealDoctorAnswersFor(key, formData);
}

export async function sendMinorDoctorForm(
  token: string,
  seatBookingId: string,
  _previous: DoctorFormState,
  formData: FormData,
): Promise<DoctorFormState> {
  const key = await doctorKey(token, seatBookingId);
  if (key === "rate") return { status: "rate" };
  if (!key) return { status: "closed" };
  return sendDoctorFormFor(key, formData);
}
