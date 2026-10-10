"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getShopBookingTripId } from "@/db/bookings";
import { getDb } from "@/db/client";
import { type PaperCourseFormOutcome, recordPaperCourseForm } from "@/db/course-forms";
import { recordCourseMaterialsDone } from "@/db/course-materials";
import { recordCourseNextStep } from "@/db/course-next-step";
import {
  courseCertifiesOnTrip,
  issueShopCertification,
  issueShopNitroxCertification,
  issueShopSpecialtyCertification,
} from "@/db/readiness";
import { diveSpecialty } from "@/db/schema";
import { DECLARABLE_CERTIFICATION_LEVELS } from "@/lib/dive-declaration";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

/**
 * A course session's roster doors: certify a student, record their next step, tick their
 * learning materials, and record a paper course form. Split from the departure's `actions.ts`
 * the way `elearning-actions.ts` and `prep/actions.ts` were, so a course fix does not open the
 * whole departure's doors.
 */

const tripPath = (shopSlug: string, tripId: string) => shopPath(shopSlug, "trips", tripId);

/**
 * The one path from "this shop's own instructor taught and ran this course"
 * to a `certifications` row this shop's own booking gate will actually read
 * (issue #717) — a per-student tap on the course session's own roster,
 * never automatic. See `issueShopCertification`'s doc comment for why the
 * card lands `verified` immediately with no number yet.
 */
export async function certifyDiverFromRosterAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const bookingId = String(formData.get("bookingId") ?? "");
  const personId = String(formData.get("personId") ?? "");
  const award = String(formData.get("award") ?? "");
  if (!uuidParam(bookingId) || !uuidParam(personId) || !award) redirect(back);
  const db = await getDb();
  // **An intro session certifies nobody** (dive-domain review). The roster
  // draws no Certify control on one, but a post reaches this regardless, and
  // a forged `award=open_water` on a DSD would otherwise land a verified card
  // the booking gate trusts. Refused before any writer is reached, for all
  // three kinds of card.
  if ((await courseCertifiesOnTrip(db, s.user.shopId, tripId)) === "not_a_certifying_course") {
    revalidateAndRedirect(back, noticeUrl(back, "certify-failed", { bid: bookingId }));
  }
  const issued = { shopId: s.user.shopId, personId, tripId, issuedByPersonId: s.user.personId };

  // **Three destinations, and two different landings.** A level card lands
  // `verified` on this tap — the instructor is the evidence (issue #717, ADR
  // 20260824-shop-issued-certification-is-verified). A specialty or nitrox card
  // lands `pending` and clears nothing until a staffer confirms it against the
  // physical card (issue #975, ADR
  // 20260827-shop-issued-specialty-cards-are-attested). The difference is
  // deliberate and the notice below says which happened, because a staffer who
  // believes a nitrox card is live when it is pending is the failure this whole
  // design is arranged to prevent.
  const level = DECLARABLE_CERTIFICATION_LEVELS.find((value) => value === award);
  const specialty = diveSpecialty.enumValues.find((value) => value === award);
  const written = level
    ? await issueShopCertification(db, { ...issued, level })
    : specialty
      ? await issueShopSpecialtyCertification(db, { ...issued, specialty })
      : award === "nitrox"
        ? await issueShopNitroxCertification(db, issued)
        : null;
  if (!level && !specialty && award !== "nitrox") redirect(back);

  revalidateAndRedirect(
    back,
    noticeUrl(
      back,
      written ? (level ? "certified" : "certified-awaiting-card") : "certify-failed",
      { bid: bookingId },
    ),
  );
}

/**
 * **What this student does next, in the instructor's own words** (issues #1196
 * and #1205).
 *
 * Beside the certify tap and under the same condition, because both are acts
 * of teaching a session. The refusals come from the writer rather than from
 * here: a departure with no course is `not_a_course_session`, which is the LMS
 * boundary stated in code (`recordCourseNextStep`).
 */
export async function saveCourseNextStepAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!uuidParam(bookingId)) redirect(back);

  const outcome = await recordCourseNextStep(await getDb(), {
    shopId: s.user.shopId,
    bookingId,
    instructorPersonId: s.user.personId,
    note: String(formData.get("note") ?? ""),
  });
  revalidateAndRedirect(
    back,
    noticeUrl(
      back,
      outcome.ok
        ? "next-step-saved"
        : outcome.reason === "too_long"
          ? "next-step-too-long"
          : outcome.reason === "not_a_course_session"
            ? "next-step-not-a-course"
            : "invalid",
      { bid: bookingId },
    ),
  );
}

/**
 * **A student's learning materials, ticked done or taken back** (ADR
 * 20261008-course-learning-materials).
 *
 * Beside the next step and under the same gate: any live staffer of this shop
 * may record it, as they may record a next step, because the person who hears
 * "I finished the eLearning" is as often the desk as the instructor. Who did is
 * stamped on the row. The refusals come from the writer — a departure with no
 * course is `not_a_course_session`, and another shop's booking id is
 * `not_found`, because the write is scoped by the session's shop.
 */
export async function setCourseMaterialsDoneAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!uuidParam(bookingId)) redirect(back);

  const outcome = await recordCourseMaterialsDone(await getDb(), {
    shopId: s.user.shopId,
    bookingId,
    staffPersonId: s.user.personId,
    done: formData.get("done") === "true",
  });
  revalidateAndRedirect(
    back,
    noticeUrl(
      back,
      outcome.ok
        ? "materials-saved"
        : outcome.reason === "not_a_course_session"
          ? "materials-not-a-course"
          : "invalid",
      { bid: bookingId },
    ),
  );
}

/** Each paper-form outcome, as the roster's notice code. */
const PAPER_COURSE_FORM_NOTICE: Record<
  Extract<PaperCourseFormOutcome, { ok: false }>["reason"],
  string
> = {
  unavailable: "course-form-unavailable",
  version_changed: "course-form-unavailable",
  invalid_signature: "course-form-unavailable",
  name_mismatch: "course-form-unavailable",
  staff_not_found: "not-authorized",
  guardian_required: "course-form-guardian",
  guardian_invalid: "course-form-guardian",
  guardian_name_matches_diver: "course-form-namesake",
  paper_copy_unconfirmed: "course-form-paper-copy",
  invalid_date: "course-form-date",
  session_ended: "course-form-ended",
};

/**
 * **Record a course form the student signed on paper** (ADR
 * 20261008-course-forms), from their row on this departure. Any staffer, as a
 * paper release is: the record names who recorded it, and
 * `recordPaperCourseForm` re-reads their live roles and the enrollment before
 * it writes. The staffer ticks that they hold the signed copy and may give the
 * date written on it. A minor's form names the guardian who co-signed it; a guardian
 * typed under the student's own name is refused unless the staffer ticks that
 * they watched two people sign.
 */
export async function recordPaperCourseFormAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const bookingId = uuidParam(String(formData.get("bookingId") ?? ""));
  const formId = uuidParam(String(formData.get("formId") ?? ""));
  if (!bookingId || !formId) redirect(noticeUrl(back, "course-form-unavailable"));
  const dbi = await getDb();
  // The row posts its own booking; one from another departure is not this
  // roster's to record against.
  if ((await getShopBookingTripId(dbi, s.user.shopId, bookingId)) !== tripId)
    redirect(noticeUrl(back, "course-form-unavailable"));
  const guardianName = String(formData.get("guardianName") ?? "").trim();
  const guardianRelationship = String(formData.get("guardianRelationship") ?? "").trim();
  const recorded = await recordPaperCourseForm(dbi, {
    shopId: s.user.shopId,
    bookingId,
    formId,
    recordedByPersonId: s.user.personId,
    paperCopyConfirmed: formData.get("paperCopy") === "on",
    signedOn: String(formData.get("signedOn") ?? "").trim() || undefined,
    guardian:
      guardianName || guardianRelationship
        ? {
            name: guardianName,
            relationship: guardianRelationship,
            namesakeAttested: formData.get("guardianNamesake") === "on",
          }
        : undefined,
  });
  const code = recorded.ok ? "course-form-recorded" : PAPER_COURSE_FORM_NOTICE[recorded.reason];
  revalidatePath(shopPath(shopSlug, "trips", tripId, "manifest"));
  revalidateAndRedirect(back, noticeUrl(back, code, { bid: bookingId }));
}
