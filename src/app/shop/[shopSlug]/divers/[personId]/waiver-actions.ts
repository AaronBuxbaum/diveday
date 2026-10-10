"use server";

import { paperGuardianFrom, paperWaiverRefused } from "@/app/actions/paper-waiver-fields";
import { queueAndAttemptMediaDeletion } from "@/db/media-deletions";
import {
  hasUnansweredMedicalHold,
  type MedicalEvaluationOutcome,
  recordInPersonWaiver,
  recordMedicalEvaluation,
} from "@/db/waivers";
import { revalidateAndRedirect } from "@/lib/navigation";
import type { PaperWaiverFormState } from "@/lib/paper-waiver-form";
import { storeMedicalClearanceDocument } from "@/lib/storage";
import { backTo, requireDiverActionContext, successUrl } from "./action-helpers";

/**
 * "This diver signed on paper", recorded from their own record.
 *
 * The third door onto one write path (`recordInPersonWaiver`) — the roster and
 * the check-in queue already have one — and the one a shop reaches when the
 * conversation is about the *person* rather than a departure: a diver phones
 * ahead, or hands the release over at the counter long before they book
 * anything.
 *
 * No booking, by design. A signature is a fact about a person and a shop, so
 * the record is filed against the diver in the URL and nothing else — the
 * subject is this route's own path segment, never a form field
 * (ADR 20260811-person-scoped-paper-waivers).
 */
export async function markWaiverInPersonAction(
  shopSlug: string,
  personId: string,
  _state: PaperWaiverFormState,
  formData: FormData,
): Promise<PaperWaiverFormState> {
  const context = await requireDiverActionContext(
    shopSlug,
    personId,
    "not-authorized-waiver",
    "waiver",
  );
  personId = context.personId;
  const { base, db, staff } = context;
  const outcome = await recordInPersonWaiver(db, {
    shopId: staff.user.shopId,
    subject: { personId },
    recordedByPersonId: staff.user.personId,
    medicalAttested: formData.get("medicalAttested") === "on",
    // A minor's paper release names its co-signer (ADR
    // 20260907-guardian-co-signature). Passed as typed; `recordInPersonWaiver`
    // decides from the date of birth on file whether it is needed at all, and
    // refuses a section that is not a signature.
    guardian: paperGuardianFrom(formData),
  });
  // **Only success navigates.** A refusal used to redirect with its own
  // `?notice=` — including the one an honest submission produces, a guardian
  // whose name is the diver's own (issue 1539) — and that redirect is what
  // emptied the form the staffer had just filled in, down to the medical tick
  // (issue #1674). It answers in the form instead, carrying the typed values
  // back, and the words are still this surface's own (`paperWaiverCopy`'s
  // `diver`): a namesake family is sent to the counter, where the confirmation
  // the other two surfaces offer is a thing somebody actually witnessed.
  if (!outcome.ok) return paperWaiverRefused(outcome.reason, formData);
  revalidateAndRedirect(base, await successUrl(context, "waiver-paper-recorded", "waiver", true));
}

/**
 * **What the physician said about this diver, recorded from their own record.**
 *
 * The end of the one readiness blocker that had no door. A referral parks the
 * release in `medical_review` and readiness refuses to board the diver; the
 * diver comes back holding a signed evaluation; before this the only lift was
 * `markWaiverInPersonAction` above, whose checkbox asserts that *no answer
 * needs physician sign-off* — untrue of exactly this diver (issue #1252).
 *
 * **Either answer** (issue #1283). A refusal is the same act with the opposite
 * result and it lifts nothing — the hold stands, readiness still refuses, and
 * what changes is only that the record can say the answer arrived. The outcome
 * is read off the form rather than assumed, and an unrecognised value is a
 * refusal rather than a guess: defaulting it would mean picking a medical
 * outcome on the staffer\'s behalf.
 *
 * Same subject rule as the paper release, and for the same reason: the diver is
 * this route's path segment, never a form field, and `recordMedicalClearance`
 * resolves their own live hold rather than trusting a posted record id.
 *
 * **Deliberately open to every live staff role**, exactly like the paper
 * attestation beside it. The reason is the dock: a diver hands the doctor's
 * letter to whoever is at the rail, and a captain who cannot record it has to
 * find an owner before anybody boards. What makes that safe is that the act is
 * *attributed* — `medical_cleared_by_person_id` names whoever pressed it — and
 * that it can only ever lift a hold the questionnaire itself created. If this
 * ever needs narrowing, the gate belongs beside `canErasePersonalData` in
 * `src/lib/authz.ts` and applies to the paper attestation too; splitting them
 * would leave the weaker door open.
 *
 * **The hold is resolved before the evaluation is stored.** Uploading first and
 * refusing second left the most sensitive file the product holds in the bucket
 * with no row pointing at it — invisible to the media-deletion ledger and to
 * `anonymizeDiver`, which walks rows (security review H2). The bad path was not
 * the abusive one but the ordinary one: a staffer opens the wrong diver's
 * record, uploads a real evaluation, and is told there is nothing to clear.
 * A stored file that the write then refuses anyway (a race, or a refusal the
 * pre-check cannot make) is queued for deletion rather than abandoned, so the
 * ledger owns it either way.
 */
export async function recordMedicalClearanceAction(
  shopSlug: string,
  personId: string,
  formData: FormData,
) {
  const context = await requireDiverActionContext(
    shopSlug,
    personId,
    "not-authorized-waiver",
    "waiver",
  );
  personId = context.personId;
  const { base, db, staff } = context;

  if (!(await hasUnansweredMedicalHold(db, staff.user.shopId, personId))) {
    revalidateAndRedirect(base, backTo(base, "medical-clearance-no-hold", "waiver"));
    return;
  }

  const posted = String(formData.get("outcome") ?? "");
  if (posted !== "cleared" && posted !== "not_cleared") {
    // Refused before the upload, like the no-hold check above it: a missing or
    // unrecognised outcome must never store a file, and it must never be
    // resolved to a default — the two answers have opposite consequences for
    // whether somebody gets in the water.
    revalidateAndRedirect(base, backTo(base, "medical-clearance-outcome-required", "waiver"));
    return;
  }
  const outcome: MedicalEvaluationOutcome = posted;

  const evaluatedOn = String(formData.get("evaluatedOn") ?? "").trim();
  const physicianName = String(formData.get("physicianName") ?? "").trim();

  const upload = formData.get("medicalClearanceDocument");
  let documentUrl: string | null = null;
  if (upload instanceof File && upload.size > 0) {
    const stored = await storeMedicalClearanceDocument({
      filename: upload.name,
      contentType: upload.type,
      bytes: await upload.arrayBuffer(),
    });
    if (stored.status !== "stored") {
      revalidateAndRedirect(base, backTo(base, "medical-clearance-document-failed", "waiver"));
      return;
    }
    documentUrl = stored.url;
  }

  const result = await recordMedicalEvaluation(db, {
    shopId: staff.user.shopId,
    personId,
    recordedByPersonId: staff.user.personId,
    outcome,
    evaluatedOn,
    physicianName,
    documentUrl,
  });
  if (!result.ok && documentUrl) {
    await queueAndAttemptMediaDeletion(db, {
      shopId: staff.user.shopId,
      kind: "waiver_document",
      url: documentUrl,
    });
  }
  revalidateAndRedirect(
    base,
    await successUrl(
      context,
      result.ok
        ? result.outcome === "cleared"
          ? "medical-clearance-recorded"
          : "medical-not-cleared-recorded"
        : MEDICAL_CLEARANCE_NOTICES[result.reason],
      "waiver",
      result.ok,
    ),
  );
}

/**
 * One refusal code to one notice, so a new refusal in the domain layer is a
 * compile error here rather than a silent fall-through to "something failed".
 */
const MEDICAL_CLEARANCE_NOTICES: Record<
  Extract<Awaited<ReturnType<typeof recordMedicalEvaluation>>, { ok: false }>["reason"],
  string
> = {
  no_medical_hold: "medical-clearance-no-hold",
  answer_already_recorded: "medical-clearance-answer-recorded",
  evaluation_date_required: "medical-clearance-date-required",
  evaluation_predates_disclosure: "medical-clearance-date-too-early",
  evaluation_in_future: "medical-clearance-date-in-future",
  evidence_required: "medical-clearance-evidence-required",
  staff_not_found: "waiver-error",
};
