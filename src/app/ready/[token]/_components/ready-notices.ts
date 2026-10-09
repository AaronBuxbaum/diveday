import type { DiverMessageKey } from "@/i18n/messages";

/**
 * Notice keys, not sentences: the query string carries a key, and the page
 * looks it up in the diver's own language. Storing the prose here would have
 * pinned every one of these to English no matter what the reader asked for
 * (docs ADR 20260729-diver-copy-localization).
 */
export const READY_NOTICES: Record<
  string,
  { tone: "success" | "danger" | "neutral"; key: DiverMessageKey }
> = {
  "pay-paid": { tone: "success", key: "ready.paymentReceived" },
  "error-waiver": { tone: "danger", key: "ready.waiverUnavailable" },
  // The diver's own words to the crew, now its own row and its own save
  // (issue 627) rather than the last field of the gear form.
  "saved-note": { tone: "success", key: "ready.noteSaved" },
  "error-note": { tone: "danger", key: "ready.noteUnavailable" },
  "error-pay": { tone: "danger", key: "ready.paymentUnavailable" },
  "pay-cancelled": { tone: "neutral", key: "ready.paymentCancelled" },
  // The code typed at booking had nothing left, so no payment page opened; the
  // seat is held and the Pay step below takes the full fare.
  "pay-code-used-up": { tone: "neutral", key: "ready.codeUsedUp" },
  // Task 49: every throttled action used to redirect with no error param at
  // all, so a rate-limited tap just looked like the button did nothing.
  "error-rate": { tone: "danger", key: "ready.rateLimited" },
  // Task 49: a failed gear/setup save (`saveFitFromReady`'s `?error=fit`)
  // had no entry here either — the same silent-failure gap, one field over.
  "error-fit": { tone: "danger", key: "ready.fitUnavailable" },
  // And its success twin, which that pass missed: the form's own "Saved." sits
  // inside the gear step, and the redirect carries no hash, so the thread comes
  // back at rest with the confirmation shut inside a closed disclosure. The
  // diver taps Save and is told nothing. The failure path was louder than the
  // success path until this row existed.
  "saved-fit": { tone: "success", key: "ready.fitSaved" },
  // Landing here fresh off a successful seat claim (docs ADR
  // 20260804-seat-claim-links) — the one moment to say whose page this now is.
  "saved-claimed": { tone: "success", key: "seatClaim.claimedNotice" },
  // A card the diver typed in. "Added", never "verified": a staff review is
  // what makes it count, and the copy says so rather than implying the
  // checklist row has cleared.
  "saved-cert": { tone: "success", key: "ready.certSaved" },
  // The number is already on file here — most often their own card, entered
  // twice. Nothing to fix, so this is neutral rather than an error.
  "saved-cert-known": { tone: "neutral", key: "ready.certKnown" },
  "error-cert": { tone: "danger", key: "ready.certInvalid" },
  // `selfCancelBooking` refused — the seat flipped to checked-in, or the boat
  // sailed, between this page rendering and the tap. The four refusal reasons
  // are deliberately never distinguished to a diver (a booking-state oracle is
  // still a leak); the shop's number is on the card below.
  "error-cancel": { tone: "danger", key: "ready.cancelUnavailable" },
  // "Anything changed?" answered — the returning diver's one question (ADR
  // 20260904-reef-all-the-way-down, D15). Its own notice because the answer
  // leaves nothing on screen that says it landed: the step simply settles, and
  // the redirect carries no hash, so the confirmation would otherwise be shut
  // inside a closed disclosure — the same gap `saved-fit` exists to close.
  "saved-changes": { tone: "success", key: "ready.savedChanges" },
  // Back from `/ready/[token]/forms` with every course form signed (ADR
  // 20261008-course-forms): the sign step settles, and this says why.
  "saved-course-forms": { tone: "success", key: "ready.savedCourseForms" },
  "error-changes": { tone: "danger", key: "ready.errorChanges" },
  "saved-tanks": { tone: "success", key: "ready.savedTanks" },
  "error-tanks": { tone: "danger", key: "ready.errorTanks" },
  "saved-contact": { tone: "success", key: "ready.savedContact" },
  "error-contact": { tone: "danger", key: "ready.errorContact" },
  // A name without a number, or a number without a name. Its own row because
  // "try it again" is the wrong instruction for it: the fix is to fill the
  // other box. The waiver's sentence, not a second one — the two forms are the
  // same two boxes, and this page already borrows that section's labels.
  "error-contact-pair": { tone: "danger", key: "waiver.errorContactPair" },
  "saved-last-dived": { tone: "success", key: "ready.lastDivedSaved" },
  "error-last-dived": { tone: "danger", key: "ready.lastDivedUnavailable" },
  // "What's this dive for?" and D18's offers below it. Both redirected with
  // `?saved=`/`?error=` codes that had no row here from the day the question
  // landed, so a diver who tapped Save was told nothing either way — the same
  // silent-failure gap `saved-fit` and `saved-changes` exist to close.
  "saved-dive-intent": { tone: "success", key: "ready.intentSaved" },
  "error-dive-intent": { tone: "danger", key: "ready.intentUnavailable" },
  "saved-re-entry-ask": { tone: "success", key: "ready.reEntrySaved" },
  "error-re-entry-ask": { tone: "danger", key: "ready.reEntryUnavailable" },
  "saved-help": { tone: "success", key: "ready.helpRequestSent" },
  "error-help": { tone: "danger", key: "ready.helpRequestUnavailable" },
  "error-help-handled": { tone: "neutral", key: "ready.helpRequestHandled" },
  // The welcome word (issue #1182). A refusal and no success notice: the
  // block's own line says what the answer now is, so a banner would be the
  // second confirmation. The refusal never says *which* of the two reasons it
  // was, for the same reason the cancel one does not.
  "error-welcome": { tone: "danger", key: "ready.welcomeUnavailable" },
};
