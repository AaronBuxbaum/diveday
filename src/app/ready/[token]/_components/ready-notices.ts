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
  "error-pay": { tone: "danger", key: "ready.paymentUnavailable" },
  // Back from the checkout a party lead opened for a seat they added (#2474).
  "pay-seat-paid": { tone: "success", key: "seatClaim.seatPaidNotice" },
  "error-seat-pay": { tone: "danger", key: "seatClaim.payUnavailable" },
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
  // "Add a seat" (UX review 2026-10-11, item 13). Each refusal names its door:
  // the boat is full, the shop has to check who is coming, the group is at the
  // one-booking cap, or the name box was empty.
  "saved-seat": { tone: "success", key: "seatClaim.addedNotice" },
  "error-seat": { tone: "danger", key: "seatClaim.addUnavailable" },
  "error-seat-full": { tone: "danger", key: "seatClaim.addFull" },
  "error-seat-ask-shop": { tone: "danger", key: "seatClaim.addAskShop" },
  "error-seat-party-full": { tone: "danger", key: "seatClaim.addPartyFull" },
  "error-seat-name": { tone: "danger", key: "seatClaim.addNameMissing" },
  // "Sign Mia's waiver" (H-20261014-parent-signs-minor-release) refused: the seat was claimed, the release
  // signed, or the boat left between the render and the tap. One answer.
  "error-minor-waiver": { tone: "danger", key: "seatClaim.minorWaiverUnavailable" },
  // A card the diver typed in. "Added", never "verified": a staff review is
  // what makes it count, and the copy says so rather than implying the
  // checklist row has cleared.
  "saved-cert": { tone: "success", key: "ready.certSaved" },
  // The number is already on file here — most often their own card, entered
  // twice. Nothing to fix, so this is neutral rather than an error.
  "saved-cert-known": { tone: "neutral", key: "ready.certKnown" },
  "saved-not-yet": { tone: "success", key: "ready.certNotYetSaved" },
  "saved-not-yet-card": { tone: "neutral", key: "ready.certNotYetCardOnFile" },
  "error-cert": { tone: "danger", key: "ready.certInvalid" },
  // `selfCancelBooking` refused — the seat flipped to checked-in, or the boat
  // sailed, between this page rendering and the tap. The four refusal reasons
  // are deliberately never distinguished to a diver (a booking-state oracle is
  // still a leak); the shop's number is on the card below.
  "error-cancel": { tone: "danger", key: "ready.cancelUnavailable" },
  // "Ask to move" (H-20261014-ask-to-move): filed in the shop's Inbox, or refused because the
  // seat is no longer one that can be asked about. The shop's number is below.
  "saved-move-ask": { tone: "success", key: "ready.moveAsk.sent" },
  "error-move-ask": { tone: "danger", key: "ready.moveAsk.unavailable" },
  // "Running late" tapped on a seat that is no longer open (J3): checked in,
  // or the boat's time has passed since the page loaded.
  "error-late": { tone: "danger", key: "ready.lateUnavailable" },
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
  // Day-of details, one form and one Save (third UX review, item 24): the
  // recency band, the intent, D18's offers, the note, the pickup, the help
  // request and the welcome word answer together, so they confirm together.
  "saved-day-of": { tone: "success", key: "ready.dayOfSaved" },
  "error-day-of": { tone: "danger", key: "ready.dayOfUnavailable" },
  // A help request the crew has already handled is theirs now; the rest of
  // the form saved.
  "error-help-handled": { tone: "neutral", key: "ready.helpRequestHandled" },
};
