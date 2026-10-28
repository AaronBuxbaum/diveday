import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { UndoToast } from "@/components/UndoToast";
import { buttonClass } from "@/components/ui/button";
import { tripAdmissionRefusalText } from "@/i18n/readiness-labels";
import { sendLimitWords } from "@/i18n/shared-sentences";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { type FormNotice, noticeFromParam, noticeRole } from "@/lib/staff-notices";
import { verifyTripAdmissionGate } from "@/lib/trip-admission-gate";
import { MOVE_SEAT_NOTICES } from "./move-seat-notices";
import { DETAILS_FORMS, ROSTER_FORMS } from "./trip-notice-tabs";

/**
 * One entry per notice code, carrying its own tone, message key(s), and the
 * **form it belongs to** — same shape as
 * `divers/[personId]/_components/NoticeBanner.tsx`'s `NOTICE_KEYS`, plus that
 * last field. A handful of refusals also carry a specific count (how many
 * divers are already booked, how many the last-minute deal reached); those get
 * a second, pluralized key used only once the count is known.
 *
 * `form` is what stopped this page answering six forms in one banner under the
 * `<h1>`. A trip has its details, its conditions, its recap note, its
 * requirements, its crew, and its series all on one long page, and the
 * last-minute deal blast even redirects to `#last-minute-deal` — scrolling the
 * banner that answered it off the top of the screen. Each code now names the
 * form it came from, `resolveTripNotice` resolves it once, and the section
 * renders it in its own action row (`FormStatus`). `"page"` is left for the
 * genuinely page-level ones: a permission refusal, and the generic `invalid`
 * fallback that any of a dozen actions can emit (those pass an explicit
 * `?form=` so they land home anyway — see `tripNoticeForm`).
 */
const NOTICE_KEYS: Record<
  string,
  {
    form: string;
    tone: "success" | "danger" | "warning";
    key: StaffMessageKey;
    countKey?: StaffMessageKey;
    /** What the key's ICU select names, for a shared sentence (`shared-sentences.ts`). */
    values?: Record<string, string>;
    /** The words name the seat's diver (`TripNoticeInput.roster`); said only when known. */
    named?: true;
  }
> = {
  saved: { form: "details", tone: "success", key: "trips.notices.saved" },
  "saved-fly-safe-unreached": {
    form: "details",
    tone: "warning",
    key: "trips.notices.savedFlySafeUnreached",
    countKey: "trips.notices.savedFlySafeUnreachedCount",
  },
  "saved-fly-safe-failed": {
    form: "details",
    tone: "warning",
    key: "trips.notices.savedFlySafeFailed",
  },
  cancelled: { form: "lifecycle", tone: "danger", key: "trips.notices.cancelled" },
  // Refused: the boat may be on the water (`cancelDeparture`). Nothing changed.
  "cancel-underway": { form: "lifecycle", tone: "danger", key: "trips.notices.cancelUnderway" },
  reinstated: { form: "lifecycle", tone: "success", key: "trips.notices.reinstated" },
  crew: { form: "crew", tone: "success", key: "trips.notices.crew" },
  "crew-conflict": { form: "crew", tone: "danger", key: "trips.notices.crewConflict" },
  "note-added": { form: "roster", tone: "success", key: "trips.notices.noteAdded" },
  "note-deleted": { form: "roster", tone: "success", key: "trips.notices.noteDeleted" },
  "booking-removed": { form: "roster", tone: "success", key: "trips.notices.bookingRemoved" },
  "booking-removed-refunded": {
    form: "roster",
    tone: "success",
    key: "trips.notices.bookingRemovedRefunded",
  },
  "booking-removed-forfeit": {
    form: "roster",
    tone: "success",
    key: "trips.notices.bookingRemovedForfeit",
  },
  "booking-removed-refund-manual": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.bookingRemovedRefundManual",
  },
  "booking-removed-refund-failed": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.bookingRemovedRefundFailed",
  },
  // Warning: a turned-away seat's money is a person's call, not the window's.
  "booking-removed-turned-away": {
    form: "roster",
    tone: "warning",
    key: "trips.notices.bookingRemovedTurnedAway",
  },
  "booking-removed-refund-review": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.bookingRemovedRefundReview",
  },
  // Warning, not danger: nothing is wrong — a refund of this seat is simply
  // already in flight, and the only thing to do is not start a second one.
  "booking-removed-refund-in-progress": {
    form: "roster",
    tone: "warning",
    key: "trips.notices.bookingRemovedRefundInProgress",
  },
  "booking-removed-refund-reconcile": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.bookingRemovedRefundReconcile",
  },
  "booking-removed-refund-owner": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.bookingRemovedRefundOwner",
  },
  "booking-restored": { form: "roster", tone: "success", key: "trips.notices.bookingRestored" },
  // Refused: the boat carried this seat or may be carrying it (H-133). Nothing
  // changed, and the row stays open on the Remove that was tapped.
  "booking-remove-aboard": {
    form: "roster",
    tone: "danger",
    key: "trips.roster.removeAboard",
    named: true,
  },
  // Refused the same way for a seat nobody counted at the dock of a sailed
  // departure: never "sailed", and the way through is the dock's Not boarded.
  "booking-remove-uncounted": {
    form: "roster",
    tone: "danger",
    key: "trips.roster.removeUncounted",
    named: true,
  },
  // A seat moved to another departure, or why it stayed (ADR 20261013-staff-move-a-seat).
  ...MOVE_SEAT_NOTICES,
  "seat-move-not-movable": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.seatMoveNotMovable",
  },
  "seat-move-departed": { form: "roster", tone: "danger", key: "trips.notices.seatMoveDeparted" },
  "seat-move-unavailable": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.seatMoveUnavailable",
  },
  "seat-move-course": { form: "roster", tone: "danger", key: "trips.notices.seatMoveCourse" },
  "seat-move-already": { form: "roster", tone: "danger", key: "trips.notices.seatMoveAlready" },
  "seat-move-earlier": { form: "roster", tone: "danger", key: "trips.notices.seatMoveEarlier" },
  "seat-move-party": { form: "roster", tone: "danger", key: "trips.notices.seatMoveParty" },
  "seat-move-buddy": { form: "roster", tone: "danger", key: "trips.notices.seatMoveBuddy" },
  "seat-move-roll-call": { form: "roster", tone: "danger", key: "trips.notices.seatMoveRollCall" },
  "seat-move-full": { form: "roster", tone: "danger", key: "trips.notices.seatMoveFull" },
  "seat-move-unstaffed": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.seatMoveUnstaffed",
  },
  "seat-move-min-age": { form: "roster", tone: "danger", key: "trips.notices.seatMoveMinAge" },
  "waitlist-carried": {
    form: "roster",
    tone: "success",
    key: "trips.notices.waitlistCarried",
    countKey: "trips.notices.waitlistCarriedCount",
  },
  "waitlist-carry-unavailable": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.waitlistCarryUnavailable",
  },
  "seat-move-prerequisite": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.seatMovePrerequisite",
  },
  "pickup-saved": { form: "roster", tone: "success", key: "trips.notices.pickupSaved" },
  "pickup-invalid": { form: "roster", tone: "danger", key: "trips.notices.pickupInvalid" },
  "dietary-saved": { form: "roster", tone: "success", key: "trips.notices.dietarySaved" },
  "dietary-invalid": { form: "roster", tone: "danger", key: "trips.notices.dietaryInvalid" },
  "booking-restore-full": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.bookingRestoreFull",
  },
  "booking-restore-ratio": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.bookingRestoreRatio",
  },
  "booking-restore-cancelled": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.bookingRestoreCancelled",
  },
  "diver-added": { form: "add-diver", tone: "success", key: "trips.notices.diverAdded" },
  // Seated for a later day and told so: the confirmation an online booking
  // gets went out (fourth UX review, item 3).
  "diver-added-confirmed": {
    form: "add-diver",
    tone: "success",
    key: "trips.notices.diverAddedConfirmed",
  },
  // Seated, but the waiver never left the building. Warning rather than
  // success: the booking is real and nothing needs undoing, yet the staffer
  // still owes the diver a link (src/app/actions/seat-diver-surfaces.ts).
  "diver-added-waiver-undelivered": {
    form: "add-diver",
    tone: "warning",
    key: "trips.notices.diverAddedWaiverUndelivered",
  },
  // Seated onto an existing diver's record on a guess, so the seat is held
  // until someone confirms it is the same person (H-13, issue #1556). Warning
  // for the same reason as the waiver code above: nothing needs undoing, and
  // the diver cannot board until the staffer acts. The confirm control is on
  // this page, on the row the `&bid=` scrolls to.
  "diver-added-identity-unconfirmed": {
    form: "add-diver",
    tone: "warning",
    key: "trips.notices.diverAddedIdentityUnconfirmed",
  },
  "diver-waitlisted": { form: "add-diver", tone: "success", key: "trips.notices.diverWaitlisted" },
  // A cold invitation is commercial mail, so a diver who turned off optional
  // email is not sent one (issue #1953). Warning, not danger: the invitation
  // is recorded and nothing needs undoing, but the staffer must not read
  // "Invited" as "emailed".
  "invitation-opted-out": {
    form: "add-diver",
    tone: "warning",
    key: "trips.notices.invitationOptedOut",
  },
  // A suggested past diver contacted with an invite inside the cooldown
  // (H-130): nothing was recorded or sent.
  "invite-cooldown": { form: "add-diver", tone: "warning", key: "trips.notices.inviteCooldown" },
  // A suggested diver this departure would no longer sell a seat to (its
  // level, a specialty, a full boat): nothing was recorded or sent (review F1).
  "invite-unavailable": {
    form: "add-diver",
    tone: "warning",
    key: "trips.notices.inviteUnavailable",
  },
  "identity-confirmed": { form: "roster", tone: "success", key: "trips.notices.identityConfirmed" },
  "identity-split": { form: "roster", tone: "success", key: "trips.notices.identitySplit" },
  // Moved to the other same-name record and still held (issue #2129).
  "identity-repointed": {
    form: "roster",
    tone: "success",
    key: "trips.notices.identityRepointed",
  },
  "identity-repoint-unavailable": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.identityRepointUnavailable",
  },
  "identity-repoint-medical-hold": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.identityRepointMedicalHold",
  },
  "identity-split-contact-conflict": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.identitySplitContactConflict",
  },
  "identity-departure-closed": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.identityDepartureClosed",
  },
  "identity-contact-differs": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.identityContactDiffers",
  },
  "identity-repoint-already-booked": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.identityRepointAlreadyBooked",
  },
  // The release a held seat was owed, sent once the desk knew who it is. When
  // it reached nobody the row hands it over (`…-waiver-ready`); when it could
  // not be issued the notice is `new-waiver-failed` (issue #2125).
  "identity-confirmed-waiver-sent": {
    form: "roster",
    tone: "success",
    key: "trips.notices.identityConfirmedWaiverSent",
  },
  "identity-split-waiver-sent": {
    form: "roster",
    tone: "success",
    key: "trips.notices.identitySplitWaiverSent",
  },
  "identity-confirmed-waiver-ready": {
    form: "roster",
    tone: "warning",
    key: "trips.notices.identityConfirmedWaiverReady",
  },
  "identity-split-waiver-ready": {
    form: "roster",
    tone: "warning",
    key: "trips.notices.identitySplitWaiverReady",
  },
  // A refused seat freed for a fresh release (`sendNewWaiverAction`). Success
  // when the email went; warning when the seat is ready but the link still has
  // to reach the diver from their row.
  "new-waiver-sent": { form: "roster", tone: "success", key: "trips.notices.newWaiverSent" },
  "new-waiver-ready": { form: "roster", tone: "warning", key: "trips.notices.newWaiverReady" },
  "new-waiver-failed": { form: "roster", tone: "danger", key: "trips.notices.newWaiverFailed" },
  // Refused by the per-staff send bound (`RATE_LIMITS.staffSendByActor`).
  "send-limit": { form: "roster", tone: "warning", ...sendLimitWords("links") },
  // A course form recorded from paper on a student's row (ADR
  // 20261008-course-forms), and its refusals — each says what to do next.
  "course-form-recorded": {
    form: "roster",
    tone: "success",
    key: "trips.notices.courseFormRecorded",
  },
  "course-form-guardian": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.courseFormGuardian",
  },
  "course-form-namesake": {
    form: "roster",
    tone: "warning",
    key: "trips.notices.courseFormNamesake",
  },
  "course-form-unavailable": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.courseFormUnavailable",
  },
  "course-form-paper-copy": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.courseFormPaperCopy",
  },
  "course-form-date": { form: "roster", tone: "danger", key: "trips.notices.courseFormDate" },
  "course-form-ended": { form: "roster", tone: "danger", key: "trips.notices.courseFormEnded" },
  "identity-medical-hold": {
    form: "roster",
    tone: "warning",
    key: "trips.notices.identityMedicalHold",
  },
  // A split refused for what the staffer typed about the new diver (issue
  // #2081). The seat stays held under the matched diver; nothing was written.
  "identity-split-dob-required": {
    form: "roster",
    tone: "warning",
    key: "trips.notices.identitySplitDobRequired",
  },
  // H-100: a blank date with no "18 or older" on a plain departure.
  "identity-split-age-unstated": {
    form: "roster",
    tone: "warning",
    key: "trips.notices.identitySplitAgeUnstated",
  },
  "identity-split-dob-invalid": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.identitySplitDobInvalid",
  },
  "identity-split-email-invalid": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.identitySplitEmailInvalid",
  },
  "identity-split-email-in-use": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.identitySplitEmailInUse",
  },
  certified: { form: "roster", tone: "success", key: "trips.notices.certified" },
  // Success, not a warning: the record landed. The tone is the same as its
  // level-card sibling and only the words differ, because what changed is what
  // happens *next*, not whether anything went wrong (issue #975).
  "certified-awaiting-card": {
    form: "roster",
    tone: "success",
    key: "trips.notices.certifiedAwaitingCard",
  },
  "certify-failed": { form: "roster", tone: "danger", key: "trips.notices.certifyFailed" },
  "next-step-saved": { form: "roster", tone: "success", key: "trips.notices.nextStepSaved" },
  "next-step-too-long": { form: "roster", tone: "danger", key: "trips.notices.nextStepTooLong" },
  // The LMS boundary, said out loud: a next step belongs to a course session
  // and this departure is not one (issues #1196, #1205).
  "next-step-not-a-course": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.nextStepNotACourse",
  },
  // A student's learning materials ticked or un-ticked (ADR
  // 20261008-course-learning-materials), and the same LMS boundary as above.
  "materials-saved": { form: "roster", tone: "success", key: "trips.notices.materialsSaved" },
  "materials-not-a-course": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.materialsNotACourse",
  },
  // A training mark on a charter seat (issue #2275), and its refusals.
  "training-marked": { form: "roster", tone: "success", key: "trips.notices.trainingMarked" },
  "training-cleared": { form: "roster", tone: "success", key: "trips.notices.trainingCleared" },
  "training-mark-already": {
    form: "roster",
    tone: "warning",
    key: "trips.notices.trainingMarkAlready",
  },
  "training-mark-invalid": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.trainingMarkInvalid",
  },
  "training-mark-over": { form: "roster", tone: "danger", key: "trips.notices.trainingMarkOver" },
  "training-mark-forms-owed": {
    form: "roster",
    tone: "warning",
    key: "trips.notices.trainingMarkFormsOwed",
  },
  "contact-saved": { form: "roster", tone: "success", key: "trips.notices.contactSaved" },
  "contact-incomplete": { form: "roster", tone: "warning", key: "trips.notices.contactIncomplete" },
  "diver-invalid": { form: "add-diver", tone: "danger", key: "trips.notices.diverInvalid" },
  "diver-seat-invalid": {
    form: "add-diver",
    tone: "danger",
    key: "trips.notices.diverSeatInvalid",
  },
  "seat-busy": { form: "add-diver", tone: "danger", key: "seatDiver.busy" },
  "diver-full": { form: "add-diver", tone: "danger", key: "trips.notices.diverFull" },
  "diver-divers-full": {
    form: "add-diver",
    tone: "danger",
    key: "participants.notices.diversFull",
  },
  "diver-type-unavailable": {
    form: "add-diver",
    tone: "danger",
    key: "participants.notices.typeUnavailable",
  },
  "booking-restore-divers-full": {
    form: "roster",
    tone: "danger",
    key: "participants.notices.restoreDiversFull",
  },
  "participant-type-set": { form: "roster", tone: "success", key: "participants.notices.typeSet" },
  "participant-type-divers-full": {
    form: "roster",
    tone: "danger",
    key: "participants.notices.diversFull",
  },
  // A type change, unlike an add, has a fix on the row: Remove booking and
  // seat them again (dive-domain review H9).
  "participant-type-unavailable": {
    form: "roster",
    tone: "danger",
    key: "participants.notices.typeChangeUnavailable",
  },
  "participant-type-on-team": {
    form: "roster",
    tone: "danger",
    key: "participants.notices.onBuddyTeam",
  },
  // Too late: the departure is home or cancelled.
  "participant-type-closed": {
    form: "roster",
    tone: "danger",
    key: "participants.notices.closed",
  },
  // Boarded as a snorkeler or rider, and the boarding gate refuses them as a
  // diver. No override: the crew clear the blocker first.
  "participant-type-boarded": {
    form: "roster",
    tone: "danger",
    key: "participants.notices.boardedNotReady",
  },
  // Saved, and a paid seat now lists higher: the difference is owed.
  "participant-type-owed": {
    form: "roster",
    tone: "warning",
    key: "participants.notices.owed",
  },
  // Joining the dive, and the card check refused: the signed gate names the
  // card, and the row offers "Change anyway" (ADR 20261007-participant-types).
  "participant-type-cert": {
    form: "roster",
    tone: "warning",
    key: "participants.notices.certBlocked",
  },
  "participant-terms-saved": {
    form: "participant-terms",
    tone: "success",
    key: "participants.terms.saved",
  },
  "participant-terms-invalid": {
    form: "participant-terms",
    tone: "danger",
    key: "participants.terms.invalid",
  },
  "participant-terms-below-booked": {
    form: "participant-terms",
    tone: "danger",
    key: "participants.terms.belowBooked",
    countKey: "participants.terms.belowBooked",
  },
  "diver-waitlist-available": {
    form: "add-diver",
    tone: "danger",
    key: "trips.notices.diverWaitlistAvailable",
  },
  "diver-already": { form: "add-diver", tone: "danger", key: "trips.notices.diverAlready" },
  "diver-course-unstaffed": {
    form: "add-diver",
    tone: "danger",
    key: "trips.notices.diverCourseUnstaffed",
  },
  "diver-course-prerequisite": {
    form: "add-diver",
    tone: "danger",
    key: "trips.notices.diverCoursePrerequisite",
  },
  "diver-course-ratio-full": {
    form: "add-diver",
    tone: "danger",
    key: "trips.notices.diverCourseRatioFull",
  },
  "diver-course-min-age": {
    form: "add-diver",
    tone: "danger",
    key: "trips.notices.diverCourseMinAge",
  },
  "diver-trip-prerequisite": {
    form: "add-diver",
    tone: "danger",
    key: "trips.notices.diverTripPrerequisite",
  },
  "diver-unavailable": { form: "add-diver", tone: "danger", key: "trips.notices.diverUnavailable" },
  "waiver-complete": { form: "roster", tone: "success", key: "trips.notices.waiverComplete" },
  // No `waiver-in-person` entry: recording a paper signature no longer
  // navigates, so there is no notice to carry. The card says it instead — the
  // control becomes "Signed on paper · <date>" where the finger just was.
  "waiver-medical-attestation": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.waiverMedicalAttestation",
  },
  "waiver-guardian-name": {
    form: "roster",
    tone: "danger",
    key: "trips.notices.waiverGuardianName",
  },
  "waiver-error": { form: "roster", tone: "danger", key: "trips.notices.waiverError" },
  "series-applied": { form: "series", tone: "success", key: "tripSeries.notices.seriesApplied" },
  "series-applied-partial": {
    form: "series",
    tone: "success",
    key: "tripSeries.notices.seriesAppliedPartial",
  },
  "series-applied-crew": {
    form: "series",
    tone: "success",
    key: "tripSeries.notices.seriesAppliedCrew",
  },
  // The details went out; some dates kept their own crew, each for a reason
  // the crew editor would refuse it for on that date alone.
  "series-applied-crew-partial": {
    form: "series",
    tone: "warning",
    key: "tripSeries.notices.seriesAppliedCrewPartial",
    countKey: "tripSeries.notices.seriesAppliedCrewPartialCount",
  },
  "series-cancelled": {
    form: "series",
    tone: "success",
    key: "tripSeries.notices.seriesCancelled",
    countKey: "tripSeries.notices.seriesCancelledCount",
  },
  // The caller may not refund (H-139): the run is canceled and the divers told,
  // and the card refunds wait for an owner or manager.
  "series-cancelled-held": {
    form: "series",
    tone: "success",
    key: "tripSeries.notices.seriesCancelledHeldCount",
    countKey: "tripSeries.notices.seriesCancelledHeldCount",
  },
  // Some dates still stand: underway by the time the call reached them, or
  // their setup failed. The shop has a next act, so it is a warning.
  "series-cancelled-partly": {
    form: "series",
    tone: "warning",
    key: "tripSeries.notices.seriesCancelledPartly",
    countKey: "tripSeries.notices.seriesCancelledPartlyCount",
  },
  "series-repeating": {
    form: "series",
    tone: "success",
    key: "tripSeries.notices.seriesRepeating",
  },
  "series-cadence-saved": {
    form: "series",
    tone: "success",
    key: "tripSeries.notices.seriesCadenceSaved",
  },
  // Warning, not success: the cadence saved, but the shop is now looking at
  // dates on the board that it no longer describes, and the next tap is theirs.
  "series-cadence-narrowed": {
    form: "series",
    tone: "warning",
    key: "tripSeries.notices.seriesCadenceNarrowed",
  },
  "series-off-cadence-cancelled": {
    form: "series",
    tone: "success",
    key: "tripSeries.notices.seriesOffCadenceCancelled",
  },
  "series-stopped": { form: "series", tone: "success", key: "tripSeries.notices.seriesStopped" },
  "series-error": { form: "series", tone: "danger", key: "tripSeries.notices.seriesError" },
  "recap-note": { form: "recap-note", tone: "success", key: "trips.notices.recapNote" },
  "recap-photo-removed": {
    form: "recap-photos",
    tone: "success",
    key: "trips.notices.recapPhotoRemoved",
  },
  "arrival-photo-failed": {
    form: "details",
    tone: "danger",
    key: "trips.notices.arrivalPhotoFailed",
  },
  requirements: { form: "requirements", tone: "success", key: "trips.notices.requirements" },
  // Saved, and it left booked divers behind. Warning rather than success: the
  // save worked and nothing needs undoing, but the staffer now owes those
  // divers a card, a conversation, or a different boat.
  "requirements-blocking": {
    form: "requirements",
    tone: "warning",
    key: "trips.notices.requirementsBlocking",
    countKey: "trips.notices.requirementsBlockingCount",
  },
  payment: { form: "roster", tone: "success", key: "trips.notices.payment" },
  "payment-amount": { form: "roster", tone: "danger", key: "trips.notices.paymentAmount" },
  "payment-method": { form: "roster", tone: "danger", key: "trips.notices.paymentMethod" },
  "payment-short": { form: "roster", tone: "danger", key: "trips.notices.paymentShort" },
  "payment-online": { form: "roster", tone: "danger", key: "trips.notices.paymentOnline" },
  "party-preview": { form: "roster", tone: "warning", key: "trips.notices.partyPreview" },
  "party-paid": { form: "roster", tone: "success", key: "trips.notices.partyPaid" },
  "party-paid-short": { form: "roster", tone: "warning", key: "trips.notices.partyPaidShort" },
  "party-over": { form: "roster", tone: "danger", key: "trips.notices.partyOver" },
  "party-nothing-owed": { form: "roster", tone: "danger", key: "trips.notices.partyNothingOwed" },
  "party-changed": { form: "roster", tone: "danger", key: "trips.notices.partyChanged" },
  conditions: { form: "conditions", tone: "success", key: "trips.notices.conditions" },
  "conditions-cleared": {
    form: "conditions",
    tone: "success",
    key: "trips.notices.conditionsCleared",
  },
  "not-authorized": { form: "page", tone: "danger", key: "trips.notices.notAuthorized" },
  invalid: { form: "page", tone: "danger", key: "trips.notices.invalid" },
  "end-before-start": { form: "details", tone: "danger", key: "trips.notices.endBeforeStart" },
  "days-out-of-order": { form: "details", tone: "danger", key: "trips.notices.daysOutOfOrder" },
  "capacity-below-booked": {
    form: "details",
    tone: "danger",
    key: "trips.notices.capacityBelowBooked",
    countKey: "trips.notices.capacityBelowBookedCount",
  },
  // This form has no boat field, so the refusal has to name the hull's number —
  // otherwise a staffer is told they are over a limit they cannot see.
  // A hull that is not this shop's live one. Reached only by a hand-built
  // submission or a boat deleted in another tab, so it reads as a plain
  // refusal rather than explaining a fleet the reader can see.
  "boat-not-found": { form: "details", tone: "danger", key: "trips.notices.boatNotFound" },
  "capacity-above-boat": {
    form: "details",
    tone: "danger",
    key: "trips.notices.capacityAboveBoat",
    countKey: "trips.notices.capacityAboveBoatCount",
  },
  // H-107: the hull's certificate is a ceiling too, and this form shows
  // neither number, so the refusal names the limit.
  "capacity-above-certificate": {
    form: "details",
    tone: "danger",
    key: "trips.notices.capacityAboveCertificate",
    countKey: "trips.notices.capacityAboveCertificateCount",
  },
  // Both doors onto the same trap: a departure that demands payment and has no
  // price asks nobody for money and blocks every diver who books it, forever
  // (issue #692). Danger, not warning — the save was refused, so the staffer
  // has something to do before anything is stored.
  "price-required-by-gate": {
    form: "details",
    tone: "danger",
    key: "trips.notices.priceRequiredByGate",
  },
  "requirements-need-price": {
    form: "requirements",
    tone: "danger",
    key: "trips.notices.requirementsNeedPrice",
  },
  "last-minute-sent": {
    form: "last-minute-deal",
    tone: "success",
    key: "trips.notices.lastMinuteSent",
    countKey: "trips.notices.lastMinuteSentCount",
  },
  "last-minute-invalid-discount": {
    form: "last-minute-deal",
    tone: "danger",
    key: "trips.notices.lastMinuteInvalidDiscount",
  },
  "last-minute-trip-unavailable": {
    form: "last-minute-deal",
    tone: "danger",
    key: "trips.notices.lastMinuteTripUnavailable",
  },
  "last-minute-trip-full": {
    form: "last-minute-deal",
    tone: "danger",
    key: "trips.notices.lastMinuteTripFull",
  },
  "last-minute-not-connected": {
    form: "last-minute-deal",
    tone: "danger",
    key: "trips.notices.lastMinuteNotConnected",
  },
  "last-minute-no-recipients": {
    form: "last-minute-deal",
    tone: "danger",
    key: "trips.notices.lastMinuteNoRecipients",
  },
  "last-minute-stripe-failed": {
    form: "last-minute-deal",
    tone: "danger",
    key: "trips.notices.lastMinuteStripeFailed",
  },
  "planned-dives-below-history": {
    form: "details",
    tone: "danger",
    key: "trips.notices.plannedDivesBelowHistory",
    countKey: "trips.notices.plannedDivesBelowHistoryCount",
  },
};

/** Every form name `NOTICE_KEYS` (or an action's `?form=`) may point at. */
const TRIP_FORMS = new Set([
  ...DETAILS_FORMS,
  ...ROSTER_FORMS,
  "page",
  "recap-note",
  "recap-photos",
]);

/**
 * Which form a `?form=` param names, ignoring anything not in `TRIP_FORMS` —
 * a query param is attacker-supplied, and an unknown name must degrade to the
 * code's own default home rather than swallowing the notice into a section
 * nothing renders.
 */
function tripNoticeForm(param: string | undefined, fallback: string): string {
  return param !== undefined && TRIP_FORMS.has(param) ? param : fallback;
}

export type TripNoticeInput = {
  notice?: string;
  /** The specific count behind a "-below-" refusal notice, e.g. the booked count or recorded dive number. */
  count?: string;
  /**
   * Which form on the page this notice answers, when the code alone cannot say
   * — `?notice=invalid` is emitted by the details editor, the conditions
   * briefing, the recap note, and the payment control alike.
   */
  form?: string;
  /**
   * The signed `TripAdmissionRefusal` behind `diver-trip-prerequisite` — which
   * requirement the trip's cert gate failed on and what the diver holds
   * (src/lib/trip-admission-gate.ts). Absent, unsigned, or signed for a
   * different departure all fall back to the notice's own generic sentence,
   * never to a blank banner and never to the specific one. Typed to admit the
   * `string[]` a repeated `?gate=` really delivers.
   */
  gate?: string | string[];
  /**
   * The departure this page *is*, read from its own path — what the signature
   * is checked against, so a genuine refusal from another boat cannot be
   * pasted onto this one.
   */
  tripId: string;
  locale: string;
  /** The seat `?bid=` names, for a notice whose words name its diver. */
  bid?: string;
  /**
   * The page's own roster, where that seat's name is read: never from the URL,
   * and a `bid` that is not on it names nobody.
   */
  roster?: readonly { booking: { id: string }; person: { fullName: string } }[];
};

/**
 * Resolves the page's `?notice=` to words and to the form those words belong
 * beside. Both trip pages call this once and hand the result to the section it
 * names (`noticeForForm`); whatever is left over — a genuinely page-level
 * refusal, or a section this staffer's role means the page never rendered —
 * falls through to `TripNoticeBanner`.
 */
export function resolveTripNotice({
  notice,
  count,
  form,
  gate,
  tripId,
  locale,
  bid,
  roster,
}: TripNoticeInput): FormNotice | undefined {
  const banner = noticeFromParam(notice, NOTICE_KEYS);
  if (!banner) return undefined;
  if (banner.named) {
    const diverName = roster?.find(({ booking }) => booking.id === bid)?.person.fullName;
    // No seat by that id on this roster: a hand-edited URL, with nobody to name.
    if (!diverName) return undefined;
    return {
      form: tripNoticeForm(form, banner.form),
      tone: banner.tone,
      text: staffTranslator(locale)(banner.key, { name: diverName }),
    };
  }
  const t = staffTranslator(locale);
  const parsedCount = count !== undefined && /^\d+$/.test(count) ? Number(count) : undefined;
  const refusal =
    notice === "diver-trip-prerequisite" || notice === "participant-type-cert"
      ? verifyTripAdmissionGate(gate, { kind: "trip", id: tripId })
      : null;
  const text = refusal
    ? tripAdmissionRefusalText(t, refusal, locale)
    : parsedCount !== undefined && banner.countKey
      ? t(banner.countKey, { count: parsedCount })
      : t(banner.key, banner.values);
  return { form: tripNoticeForm(form, banner.form), tone: banner.tone, text };
}

/**
 * The page-level banner, now only for what has no form to sit beside: a
 * permission refusal and any roster removal that still has an undo action.
 */
export function TripNoticeBanner({
  notice,
  locale,
  undoBookingId,
  undoAction,
}: {
  notice?: FormNotice;
  locale: string;
  undoBookingId?: string;
  // Only the roster's reversible removals carry an undo; Overview's config
  // notices render the same banner without one.
  undoAction?: (formData: FormData) => void;
}) {
  if (!notice) return null;
  const t = staffTranslator(locale);
  if (notice.tone === "success" && undoBookingId && undoAction) {
    return (
      <UndoToast
        message={notice.text}
        action={undoAction}
        fields={{ bookingId: undoBookingId }}
        pendingLabel={t("trips.notices.undoing")}
        undoLabel={t("trips.notices.undo")}
        dismissLabel={t("shared.undoToast.dismiss")}
      />
    );
  }

  return (
    <div className="mt-6">
      <ShopNotice tone={notice.tone} role={noticeRole(notice.tone)}>
        <div className="flex items-center justify-between gap-3">
          <span>{notice.text}</span>
          {undoBookingId && undoAction ? (
            <form action={undoAction}>
              <input type="hidden" name="bookingId" value={undoBookingId} />
              <SubmitButton
                pendingLabel={t("trips.notices.undoing")}
                className={buttonClass({
                  variant: "link",
                  size: "sm",
                  busy: true,
                  className: "underline-offset-2",
                })}
              >
                {t("trips.notices.undo")}
              </SubmitButton>
            </form>
          ) : null}
        </div>
      </ShopNotice>
    </div>
  );
}
