"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { confirmCarriedFacts } from "@/db/bookings";
import { getDb } from "@/db/client";
import {
  getCourseFormsForBooking,
  type SignCourseFormOutcome,
  signCourseForm,
  verifyCourseFormsLink,
} from "@/db/course-forms";
import { issueWaiverRequest, saveBookingEmergencyContact } from "@/db/waivers";
import { emergencyContactSchema, readEmergencyContact } from "@/lib/contact";
import { revalidateAndRedirect } from "@/lib/navigation";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { base, bounceTarget, contextFor, refuseWhileHeld } from "./action-helpers";

/**
 * Sign the waiver from the page. We can't reconstruct an existing bearer token
 * (only its hash is stored), so this issues a fresh link for the booking and
 * sends the diver straight to it. Reissuing supersedes any prior pending link,
 * which is the intended behaviour.
 */
export async function signWaiverFromReady(token: string) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  refuseWhileHeld(token, ctx.data);
  const issued = await issueWaiverRequest(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
  });
  if (!issued.ok) redirect(`${base(token)}?error=waiver`);
  redirect(`/waivers/${issued.token}`);
}

/**
 * **Who to call**, on its own.
 *
 * New reach for the readiness capability — the emergency contact has been
 * written from the *waiver* token until now — and bounded the same way that one
 * is: the shared `emergencyContactSchema` (max 120/40, the bound CR-014 added
 * precisely because this page's equivalent action once had none), and
 * `saveBookingEmergencyContact`, which resolves the person from the booking the
 * verified capability names rather than from anything posted.
 *
 * It never blanks a field, which is that writer's own standing rule: a diver
 * who submits an empty box keeps what is on file. A contact on a manifest is
 * safety data, and a silent clear is worse than a stale one.
 *
 * **The two boxes move together.** This form prefills from the record, so a
 * new name typed over a cleared number is not a partial edit to merge: merging
 * it would keep the *old* contact's phone under the new contact's name, which
 * dials a stranger on the one day it matters (`readEmergencyContact`). Refused
 * here, on its own notice, because the writer can only decline it silently.
 */
export async function saveEmergencyContactFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  refuseWhileHeld(token, ctx.data);
  const parsed = emergencyContactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=contact`);
  const submitted = readEmergencyContact({
    name: parsed.data.emergencyContactName,
    phone: parsed.data.emergencyContactPhone,
  });
  if (submitted.kind === "half") redirect(`${base(token)}?error=contact-pair`);
  const saved = await saveBookingEmergencyContact(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    name: parsed.data.emergencyContactName,
    phone: parsed.data.emergencyContactPhone,
    actor: "bearer",
  });
  if (!saved) redirect(`${base(token)}?error=contact`);
  await confirmCarriedFacts(ctx.db, { shopId: ctx.data.shop.id, bookingId: ctx.bookingId });
  revalidateAndRedirect(base(token), `${base(token)}?saved=contact`);
}

const courseFormSignSchema = z.object({
  formVersionId: z.uuid(),
  signerName: z.string().trim().max(120),
  acknowledged: z.literal("on").optional(),
  guardianName: z.string().trim().max(120).optional(),
  guardianRelationship: z.string().trim().max(40).optional(),
  guardianAcknowledged: z.literal("on").optional(),
});

/** Each refusal's one word on the URL; the page picks the sentence. */
const COURSE_FORM_ERROR: Record<Exclude<SignCourseFormOutcome, { ok: true }>["reason"], string> = {
  unavailable: "unavailable",
  version_changed: "version",
  invalid_signature: "agreement",
  name_mismatch: "name",
  guardian_required: "guardian",
  guardian_invalid: "guardian",
};

/**
 * **Sign one course form from the diver's link** (ADR 20261008-course-forms).
 * Either link that opens the forms page may sign on it — the readiness link
 * or the forms-only one (`verifyCourseFormsLink`), rate-limited before it
 * verifies, like every action here — and nothing else in this file accepts the
 * forms-only one. `signCourseForm` checks everything else against the booking
 * itself: a held seat, the typed name is the student's, the version is one the
 * course asks for, a minor's form carries a guardian. Back to the forms page
 * while any are owed, then to the prep page when the link can open it.
 */
export async function signCourseFormFromReady(token: string, formData: FormData) {
  const forms = `${base(token)}/forms`;
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("readiness-token", ip), RATE_LIMITS.capabilityAction))
      .allowed
  ) {
    redirect(`${forms}?error=rate`);
  }
  const db = await getDb();
  const link = await verifyCourseFormsLink(db, token);
  if (!link) redirect(forms);
  const parsed = courseFormSignSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${forms}?error=agreement`);
  const guardianPosted =
    parsed.data.guardianName !== undefined || parsed.data.guardianRelationship !== undefined;
  const signed = await signCourseForm(db, {
    shopId: link.shopId,
    bookingId: link.bookingId,
    formVersionId: parsed.data.formVersionId,
    signerName: parsed.data.signerName,
    agreed: parsed.data.acknowledged === "on",
    guardian: guardianPosted
      ? {
          name: parsed.data.guardianName ?? "",
          relationship: parsed.data.guardianRelationship ?? "",
          agreed: parsed.data.guardianAcknowledged === "on",
        }
      : undefined,
  });
  if (!signed.ok) redirect(`${forms}?error=${COURSE_FORM_ERROR[signed.reason]}`);
  const left = await getCourseFormsForBooking(db, link.shopId, link.bookingId);
  if (left && left.outstanding.length > 0) revalidateAndRedirect(forms, `${forms}?signed=1`);
  // A forms-only link has no prep page to return to; its forms page says done.
  if (link.formsOnly) revalidateAndRedirect(forms, forms);
  revalidateAndRedirect(base(token), `${base(token)}?saved=course-forms`);
}
