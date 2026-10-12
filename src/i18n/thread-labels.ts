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
 * the step ("Next: sign your waiver, about two minutes.", not "Next: Sign").
 * The sign step speaks for two things: the release, and the course forms an
 * enrollment can still owe once the release is on file (issue #2266). Only
 * the release is promised at two minutes; a diver whose release is signed and
 * whose forms are not is asked for the forms by name.
 */
export const THREAD_STEP_NEXT_KEYS: Record<Exclude<ThreadStepId, "sign">, DiverMessageKey> = {
  certification: "thread.next.certification",
  pay: "thread.next.pay",
  gear: "thread.next.gear",
  changes: "thread.next.changes",
  dayof: "thread.next.dayof",
};

export function threadNextKey(step: Pick<ThreadStep, "id" | "item">): DiverMessageKey {
  if (step.id !== "sign") return THREAD_STEP_NEXT_KEYS[step.id];
  return step.item?.state === "done" ? "thread.next.signForms" : "thread.next.signWaiver";
}
