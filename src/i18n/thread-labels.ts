import type { ReadinessBlockerCode } from "@/lib/readiness";
import type { ThreadStep, ThreadStepId, ThreadStepState } from "@/lib/thread-steps";
import type { DiverMessageKey } from "./messages";

/**
 * The diver's thread, in words (ADR 20260827-the-divers-thread, decision 3).
 *
 * `src/lib/thread-steps.ts` returns ids and states and no copy at all, exactly
 * as `readiness-summary.ts` returns codes — this is the one place either
 * becomes a sentence, so a step cannot be named two ways on two surfaces.
 *
 * **The step asks in a divemaster's words, never a checkpoint's.** These are
 * deliberately not the retired `ready.checklistCategory*` nouns ("Waiver",
 * "Certification", "Payment"): a diver walking their own thread is being asked
 * to do a thing, not shown the name of a compliance bucket.
 */
export const THREAD_STEP_TITLE_KEYS: Record<ThreadStepId, DiverMessageKey> = {
  sign: "thread.stepSign",
  certification: "thread.stepCertification",
  pay: "thread.stepPay",
  gear: "thread.stepGear",
  // The gear step's other spelling, for the diver whose sizes the shop was
  // already holding (ADR 20260904-reef-all-the-way-down, D15). One slot, and a
  // question rather than a noun, because that is what is genuinely being asked.
  changes: "thread.stepChanges",
  dayof: "thread.stepDayOf",
};

/**
 * The state in words beside the mark that carries its colour — the
 * accessibility commitment ADR 20260827-clearwater-surface-language keeps
 * verbatim ("every colour-carried state also carries a word").
 *
 * `done` has no entry: a settled step's word is its own settled line ("Signed
 * and on file", "Your sizes are with the crew"), which says more than "Done"
 * and is what `SettledCheck` is handed. A word for a state that already
 * speaks would be the caption the copy-restraint filter deletes.
 */
export const THREAD_STEP_STATE_KEYS: Record<Exclude<ThreadStepState, "done">, DiverMessageKey> = {
  your_turn: "ready.stateAction",
  with_shop: "ready.stateWaiting",
};

/**
 * **What the thread asks next, as a sentence** (UX review 2026-10-10, item 9).
 *
 * The status head leads with this line, so it says the act rather than naming
 * the step ("Next: sign your waiver.", not "Next: Sign"). The step row under
 * it already says how long the release takes, so this line does not repeat it.
 *
 * The sign and certification steps each speak for several readiness codes, and
 * one sentence for all of them would ask a diver to do the wrong thing: a
 * diver short a level is not helped by "add your certification", and a minor
 * cannot sign their own waiver. Those two steps branch on the item's code in
 * `threadNextKey`; every other step has one sentence here.
 */
export const THREAD_STEP_NEXT_KEYS: Record<
  Exclude<ThreadStepId, "sign" | "certification">,
  DiverMessageKey
> = {
  pay: "thread.next.pay",
  gear: "thread.next.gear",
  changes: "thread.next.changes",
  dayof: "thread.next.dayof",
};

/**
 * The certification step's sentence, for **every** code `BLOCKER_CATEGORY`
 * files under "certification" — the shop-side waits included, so a diver
 * whose card is already in is never asked to add it again (the test walks
 * the category, so a new code without a sentence fails it). Only an item with
 * no code at all falls back to the step's plain ask.
 */
export type CertificationNextCode = Extract<
  ReadinessBlockerCode,
  | "certification_missing"
  | "certification_pending"
  | "certification_self_declared"
  | "certification_insufficient"
  | "certification_in_training"
  | "certification_not_yet"
  | "specialty_missing"
  | "specialty_pending"
  | "specialty_import_unconfirmed"
  | "nitrox_missing"
  | "nitrox_pending"
  | "nitrox_self_declared"
>;

export const CERTIFICATION_NEXT_KEYS: Record<CertificationNextCode, DiverMessageKey> = {
  certification_missing: "thread.next.certification",
  certification_pending: "thread.next.cardWithShop",
  certification_self_declared: "thread.next.certification",
  certification_insufficient: "thread.next.certificationLevel",
  // The card is the instructor's to issue; the diver's part is the course.
  certification_in_training: "thread.next.certificationInTraining",
  // The diver has answered; the crew's conversation at the dock is next.
  certification_not_yet: "thread.next.certificationNotYet",
  specialty_missing: "thread.next.specialty",
  specialty_pending: "thread.next.cardWithShop",
  specialty_import_unconfirmed: "thread.next.cardWithShop",
  nitrox_missing: "thread.next.nitrox",
  nitrox_pending: "thread.next.cardWithShop",
  nitrox_self_declared: "thread.next.nitrox",
};

/**
 * The sign step's sentence, for every code `BLOCKER_CATEGORY` files under
 * "waiver": the release, the medical hold that rides on it, and the course
 * forms that share the step (ADR 20261008-course-forms).
 */
export type SignNextCode = Extract<
  ReadinessBlockerCode,
  | "waiver_not_sent"
  | "waiver_lapsed"
  | "waiver_runs_out"
  | "waiver_pending"
  | "waiver_expired"
  | "medical_review"
  | "medical_not_cleared"
  | "guardian_signature_missing"
  | "course_form_unsigned"
  | "course_form_guardian_missing"
>;

export const SIGN_NEXT_KEYS: Record<SignNextCode, DiverMessageKey> = {
  // No link ever issued; the honest ask is the shop, not an email we can't promise.
  waiver_not_sent: "thread.next.askForWaiver",
  // Signed once already: the same fresh link an expired one needs.
  waiver_lapsed: "thread.next.freshWaiver",
  waiver_runs_out: "thread.next.freshWaiver",
  waiver_pending: "thread.next.signWaiver",
  waiver_expired: "thread.next.freshWaiver",
  medical_review: "thread.next.medical",
  medical_not_cleared: "thread.next.medical",
  guardian_signature_missing: "thread.next.signGuardian",
  course_form_unsigned: "thread.next.signForms",
  course_form_guardian_missing: "thread.next.signFormsGuardian",
};

export function threadNextKey(step: Pick<ThreadStep, "id" | "item">): DiverMessageKey {
  if (step.id === "sign") {
    // The release is on file and the course forms are what is left (issue #2266).
    if (step.item?.state === "done") return "thread.next.signForms";
    const code = step.item?.code;
    return code && Object.hasOwn(SIGN_NEXT_KEYS, code)
      ? SIGN_NEXT_KEYS[code as SignNextCode]
      : "thread.next.signWaiver";
  }
  if (step.id === "certification") {
    // Several cards short is one row with several jobs; name them together.
    if (step.item?.detailCode === "certification_multiple_needed") {
      return "thread.next.certificationMultiple";
    }
    const code = step.item?.code;
    return code && Object.hasOwn(CERTIFICATION_NEXT_KEYS, code)
      ? CERTIFICATION_NEXT_KEYS[code as CertificationNextCode]
      : "thread.next.certification";
  }
  return THREAD_STEP_NEXT_KEYS[step.id];
}
