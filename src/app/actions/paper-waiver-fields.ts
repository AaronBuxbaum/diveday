import type { InPersonWaiverOutcome } from "@/db/waivers";
import type {
  PaperWaiverFormState,
  PaperWaiverRefusal,
  PaperWaiverTypedValues,
} from "@/lib/paper-waiver-form";

/**
 * **The fields `PaperWaiverControl` submits for a minor**, read back
 * (ADR 20260907-guardian-co-signature).
 *
 * Three staff surfaces open the same paper-release form — the trip roster, the
 * counter queue and the diver's own record — and all three hand what comes
 * back to `recordInPersonWaiver`. Reading them in one place is what keeps
 * the three doors onto one write path from drifting into three parsers, in the
 * same spirit as `src/app/actions/seat-diver-surfaces.ts`.
 *
 * Nothing is validated here. `recordInPersonWaiver` decides from the date of
 * birth on file whether a guardian is needed at all, refuses a relationship
 * that is not one of the codes, and refuses a name that is the diver's own
 * unless the namesake confirmation came with it — so a value invented by a
 * hand-built request never reaches a record. Returns `undefined` when the form
 * carried no guardian section, which is every adult.
 *
 * `guardianNamesakeAttested` is the staffer's own assertion that this parent
 * and this diver really do share a name on their IDs and that they watched
 * both of them sign (issue #1573). Read here because all three surfaces submit
 * it; honoured by the writer only when the two names actually match, and never
 * offered on the online path at all.
 */
export function paperGuardianFrom(
  formData: FormData,
): { name: string; relationship: string; namesakeAttested: boolean } | undefined {
  const name = formData.get("guardianName");
  const relationship = formData.get("guardianRelationship");
  if (typeof name !== "string" || typeof relationship !== "string") return undefined;
  if (!name.trim() || !relationship.trim()) return undefined;
  return {
    name,
    relationship,
    namesakeAttested: formData.get("guardianNamesakeAttested") === "on",
  };
}

/**
 * The same three fields read back **as the staffer typed them**, for a refusal
 * to hand to the form it came from (issue #1674, `src/lib/paper-waiver-form.ts`).
 *
 * Separate from `paperGuardianFrom` above and not folded into it: that one
 * answers "is there a guardian section here at all" and returns `undefined`
 * for an adult, which is the question the *writer* asks. This one answers
 * "what was on screen", which has to survive a blank name and a missing
 * relationship — precisely the submissions that get refused. Echoed verbatim,
 * never trimmed: a trim here would silently correct a name on a document
 * somebody is attesting to, and `"J "` reaching `guardian_invalid` is exactly
 * the value the staffer needs to see to fix it.
 *
 * The namesake tick is deliberately not carried back. It is drawn only on a
 * form that has already been refused for the name, so on the pass that offers
 * it there is nothing to restore, and re-ticking it across a *different*
 * refusal would re-assert something the staffer did not re-assert.
 */
export function paperWaiverTypedFrom(formData: FormData): PaperWaiverTypedValues {
  const name = formData.get("guardianName");
  const relationship = formData.get("guardianRelationship");
  return {
    medicalAttested: formData.get("medicalAttested") === "on",
    guardianName: typeof name === "string" ? name : "",
    guardianRelationship: typeof relationship === "string" ? relationship : "",
  };
}

/**
 * **Every way the writer can refuse, folded onto the four the form can say.**
 *
 * Total over `recordInPersonWaiver`'s reasons on purpose: a new refusal reason
 * is a type error here rather than a form that renders nothing. Eight of the
 * eleven share `error` because the staffer's next move is the same for every
 * "that row is not what you think it is" — and the form marks every field
 * required, so reaching one of those eight means the request did not come from
 * the form at all. The other three name the act that clears them: tick the
 * attestation, confirm a namesake co-signer, confirm whose seat this is.
 *
 * This replaces the per-surface `?notice=` tables the three actions used to
 * build (`IN_PERSON_WAIVER_NOTICE` and two ternaries). The words still differ
 * per surface — the counter tells a namesake family to tick the confirmation,
 * the diver's record sends them to the counter — and that lives in
 * `paperWaiverCopy`, which is where words live.
 */
const REFUSAL: Record<Extract<InPersonWaiverOutcome, { ok: false }>["reason"], PaperWaiverRefusal> =
  {
    medical_attestation_required: "medical_attestation",
    guardian_name_matches_diver: "guardian_name",
    identity_unconfirmed: "identity_unconfirmed",
    booking_not_found: "error",
    booking_unavailable: "error",
    person_not_found: "error",
    template_not_found: "error",
    staff_not_found: "error",
    invalid_signature: "error",
    guardian_required: "error",
    guardian_invalid: "error",
  };

/** The refused state a paper-waiver action answers with, values and all. */
export function paperWaiverRefused(
  reason: Extract<InPersonWaiverOutcome, { ok: false }>["reason"],
  formData: FormData,
): PaperWaiverFormState {
  return { status: "refused", refusal: REFUSAL[reason], typed: paperWaiverTypedFrom(formData) };
}
