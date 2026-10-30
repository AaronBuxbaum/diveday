import type { DiverMergeRefusal } from "@/db/diver-merge";
import type { SendStaffReplyRefusal, SendWhatsAppReopenRefusal } from "@/db/staff-reply";
import { tripAdmissionRefusalText } from "@/i18n/readiness-labels";
import { sendLimitWords } from "@/i18n/shared-sentences";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { type FormNotice, type NoticeCodeOf, noticeFromParam } from "@/lib/staff-notices";
import { verifyTripAdmissionGate } from "@/lib/trip-admission-gate";

/**
 * A notice that names something the staffer can go and fix carries the link to
 * it, rather than describing a place and leaving them to find it. Only the
 * refusals that have somewhere to send someone get one, which since the
 * record's recomposition is exactly one.
 */
type NoticeLink = { key: StaffMessageKey; href: (shopSlug: string) => string };

/**
 * Each notice code maps to a tone, message key, and owning form. `field` marks
 * a specific control when a refusal can be tied to one.
 */
type DiverNoticeDefinition = {
  form: string;
  tone: "success" | "danger" | "warning";
  /** Absent only when `silent` is — nothing renders, so there is nothing to say. */
  key?: StaffMessageKey;
  /** The values `key` takes, for a shared sentence (`src/i18n/shared-sentences.ts`). */
  values?: Record<string, string>;
  field?: string;
  /**
   * A pure "it worked" outcome the surface already shows on its own: a
   * captured card lands in the list right below as a new pending row, so a
   * banner repeating "captured as pending" would be a caption on a
   * photograph of itself (copy-restraint, deletion #1). Routing (`form`)
   * still resolves normally — only the text is withheld, by both
   * `DiverFormStatus` and `NoticeBanner`.
   */
  silent?: true;
};

/**
 * Require exhaustive notice coverage for refusal unions forwarded by this
 * page's reply, reopen, and merge actions. Merge's `not_authorized` and
 * `not_found` are translated to page-specific codes before reaching this map.
 * Seating refusals are exhaustive in `SEAT_SURFACES.diver.refusalNotice`;
 * certification review collapses unlisted reasons to `invalid`.
 */
type OwnedDiverNoticeReason =
  | `reply_${SendStaffReplyRefusal}`
  | `reopen_${SendWhatsAppReopenRefusal}`
  | `merge_${Exclude<DiverMergeRefusal, "not_authorized" | "not_found">}`;

/** Loose in the keys it accepts, exact in the ones it demands. */
type DiverNoticeMap = Record<string, DiverNoticeDefinition> &
  Record<NoticeCodeOf<OwnedDiverNoticeReason>, DiverNoticeDefinition>;

/**
 * One entry per notice code, carrying its tone, its message key, and — the
 * field that changed here — the form it belongs to. See `DiverNoticeMap` above
 * for which halves of it are proved by the type and which are borrowed.
 */
const NOTICE_KEYS: DiverNoticeMap = {
  // Cards — the two card sections emit the same codes, so their actions stamp
  // an explicit `?form=`; these defaults are what an old link still resolves to.
  captured: { form: "cards", tone: "success", silent: true },
  // The row visibly changes to "Certified" and the control shows its own toast.
  verified: { form: "cards", tone: "success", silent: true },
  "card-restored": { form: "cards", tone: "success", key: "divers.notices.cardRestored" },
  "card-restore-conflict": {
    form: "cards",
    tone: "danger",
    key: "divers.notices.cardRestoreConflict",
  },
  // The card-removal toast is handled by the page itself (`UndoToast`); this
  // entry is the fallback for a `?notice=card-deleted` with no id to undo.
  "card-deleted": { form: "cards", tone: "success", key: "divers.notices.cardDeleted" },
  // Self-declared cards require a sighting before certification.
  "card-sighting-required": {
    form: "cards",
    tone: "danger",
    key: "divers.notices.cardSightingRequired",
  },
  // The identifier is invalid; attach the refusal to its input.
  "card-number-implausible": {
    form: "cards",
    tone: "danger",
    key: "divers.notices.cardNumberImplausible",
    field: "sighted-identifier",
  },
  "duplicate-card": { form: "cards", tone: "danger", key: "divers.notices.duplicateCard" },
  // Clearing the stamp removes its panel, so the confirmation belongs on page.
  "no-certification-cleared": {
    form: "page",
    tone: "success",
    key: "divers.notices.noCertificationCleared",
  },
  // The record already reflects the requested state; this is neither a failure
  // nor a new success.
  "no-certification-nothing-to-clear": {
    form: "page",
    tone: "warning",
    key: "divers.notices.noCertificationNothingToClear",
  },
  // The row holding the control changes state on success.
  "drysuit-experience-recorded": {
    form: "page",
    tone: "success",
    key: "divers.notices.drysuitExperienceRecorded",
  },
  "drysuit-experience-cleared": {
    form: "page",
    tone: "success",
    key: "divers.notices.drysuitExperienceCleared",
  },
  // A double tap or replay: the record already says what the staffer wanted.
  "drysuit-experience-unchanged": {
    form: "page",
    tone: "warning",
    key: "divers.notices.drysuitExperienceUnchanged",
  },
  // Refusals from the writer itself (domain review A4, security review X2/X3).
  "drysuit-experience-not-authorized": {
    form: "page",
    tone: "danger",
    key: "divers.notices.drysuitExperienceNotAuthorized",
  },
  "drysuit-experience-note-required": {
    form: "page",
    tone: "warning",
    key: "divers.notices.drysuitExperienceNoteRequired",
  },
  "drysuit-experience-not-recordable": {
    form: "page",
    tone: "warning",
    key: "divers.notices.drysuitExperienceNotRecordable",
  },
  // Applies across card actions, so it has no single owning form.
  "not-authorized-cards": {
    form: "page",
    tone: "danger",
    key: "divers.notices.notAuthorizedCards",
  },

  // The row shows the saved value, so save and clear are silent.
  "last-dive-saved": { form: "last-dive", tone: "success", silent: true },
  "last-dive-cleared": { form: "last-dive", tone: "success", silent: true },
  "last-dive-invalid": {
    form: "last-dive",
    tone: "danger",
    key: "divers.notices.lastDiveInvalid",
  },
  "last-dive-future": {
    form: "last-dive",
    tone: "danger",
    key: "divers.notices.lastDiveFuture",
  },
  // The stored later dive remains the row's displayed value.
  "last-dive-saved-later-known": {
    form: "last-dive",
    tone: "warning",
    key: "divers.notices.lastDiveSavedLaterKnown",
  },
  "not-authorized-last-dive": {
    form: "last-dive",
    tone: "danger",
    key: "divers.notices.notAuthorizedDetails",
  },

  // Details editor.
  "person-saved": { form: "details", tone: "success", key: "divers.notices.personSaved" },
  // The date already establishes age, so the unused adult answer is reported.
  "person-saved-adult-answer-unused": {
    form: "details",
    tone: "warning",
    key: "divers.notices.personSavedAdultAnswerUnused",
    field: "diver-date-of-birth",
  },
  "not-authorized-details": {
    form: "details",
    tone: "danger",
    key: "divers.notices.notAuthorizedDetails",
  },
  duplicate: {
    form: "details",
    tone: "danger",
    key: "divers.notices.duplicate",
    // The refusal is about one box, so it renders on that box.
    field: "diver-email",
  },
  "date-of-birth-age-unstated": {
    form: "details",
    tone: "danger",
    key: "divers.notices.dateOfBirthAgeUnstated",
    field: "diver-date-of-birth",
  },
  "date-of-birth-course-minimum-age": {
    form: "details",
    tone: "danger",
    key: "divers.notices.dateOfBirthCourseMinimumAge",
    field: "diver-date-of-birth",
  },
  "removed-read-only": {
    form: "details",
    tone: "danger",
    key: "divers.notices.removedReadOnly",
  },

  // The release was recorded from this diver record.
  "waiver-paper-recorded": {
    form: "waiver",
    tone: "success",
    key: "divers.notices.waiverPaperRecorded",
  },
  "waiver-medical-attestation": {
    form: "waiver",
    tone: "warning",
    key: "divers.notices.waiverMedicalAttestation",
  },
  "waiver-guardian-name": {
    form: "waiver",
    tone: "danger",
    key: "divers.notices.waiverGuardianName",
  },
  "waiver-error": { form: "waiver", tone: "danger", key: "divers.notices.waiverError" },

  // Physician clearance recorded against a medical hold.
  "medical-clearance-recorded": {
    form: "waiver",
    tone: "success",
    key: "divers.notices.medicalClearanceRecorded",
  },
  // Clearance answers this referral, while another earlier referral remains.
  "medical-clearance-recorded-earlier-held": {
    form: "waiver",
    tone: "warning",
    key: "divers.notices.medicalClearanceRecordedEarlierHeld",
  },
  // A recorded negative answer is a warning: the record is accurate, but the
  // medical hold remains.
  "medical-not-cleared-recorded": {
    form: "waiver",
    tone: "warning",
    key: "divers.notices.medicalNotClearedRecorded",
  },
  // No medical hold is currently awaiting clearance.
  "medical-clearance-no-hold": {
    form: "waiver",
    tone: "warning",
    key: "divers.notices.medicalClearanceNoHold",
  },
  "medical-clearance-document-failed": {
    form: "waiver",
    tone: "danger",
    key: "divers.notices.medicalClearanceDocumentFailed",
  },
  "medical-clearance-date-required": {
    form: "waiver",
    tone: "danger",
    key: "divers.notices.medicalClearanceDateRequired",
  },
  "medical-clearance-date-too-early": {
    form: "waiver",
    tone: "danger",
    key: "divers.notices.medicalClearanceDateTooEarly",
  },
  "medical-clearance-date-in-future": {
    form: "waiver",
    tone: "danger",
    key: "divers.notices.medicalClearanceDateInFuture",
  },
  "medical-clearance-evidence-required": {
    form: "waiver",
    tone: "danger",
    key: "divers.notices.medicalClearanceEvidenceRequired",
  },
  // The submitted form must be reviewed and its physician recorded.
  "medical-clearance-diver-form-physician": {
    form: "waiver",
    tone: "danger",
    key: "divers.notices.medicalClearanceDiverFormPhysician",
  },
  "medical-clearance-diver-form-not-opened": {
    form: "waiver",
    tone: "danger",
    key: "divers.notices.medicalClearanceDiverFormNotOpened",
  },
  // The submitted form was rejected and deleted; the diver may send another.
  "diver-form-not-used": {
    form: "waiver",
    tone: "success",
    key: "divers.notices.diverFormNotUsed",
  },
  "diver-form-gone": {
    form: "waiver",
    tone: "warning",
    key: "divers.notices.diverFormGone",
  },
  // The server refuses when no outcome is selected rather than choosing one.
  "medical-clearance-outcome-required": {
    form: "waiver",
    tone: "danger",
    key: "divers.notices.medicalClearanceOutcomeRequired",
  },
  // The physician's answer is already recorded and is not overwritten.
  "medical-clearance-answer-recorded": {
    form: "waiver",
    tone: "warning",
    key: "divers.notices.medicalClearanceAnswerRecorded",
  },

  // These notices reuse the work-order bundle shared with the ticket page.
  "piece-added": { form: "work-orders", tone: "success", key: "workOrders.notice.pieceAdded" },
  "piece-deleted": { form: "work-orders", tone: "success", key: "workOrders.notice.pieceDeleted" },
  "piece-restored": {
    form: "work-orders",
    tone: "success",
    key: "workOrders.notice.pieceRestored",
  },
  "on-open-work-order": {
    form: "work-orders",
    tone: "warning",
    key: "workOrders.notice.onOpenWorkOrder",
  },

  // Rental fit.
  "profile-saved": { form: "fit", tone: "success", key: "divers.notices.profileSaved" },
  "fit-flagged": { form: "fit", tone: "success", key: "divers.notices.fitFlagged" },
  "fit-cleared": { form: "fit", tone: "success", key: "divers.notices.fitCleared" },
  "not-authorized-fit": { form: "fit", tone: "danger", key: "divers.notices.notAuthorizedFit" },
  "not-authorized-waiver": {
    form: "waiver",
    tone: "danger",
    key: "divers.notices.notAuthorizedWaiver",
  },

  // The invoice setup refusal links to the place staff can fix the payment
  // connection.
  "payment-not-connected": {
    form: "story",
    tone: "warning",
    key: "divers.notices.paymentNotConnected",
  },
  // Notes are staff context shared with the boat manifest.
  "note-added": { form: "notes", tone: "success", key: "divers.notices.noteAdded" },
  "note-deleted": { form: "notes", tone: "success", key: "divers.notices.noteDeleted" },
  "not-authorized-notes": {
    form: "notes",
    tone: "danger",
    key: "divers.notices.notAuthorizedNotes",
  },

  // Reply notices use inbox copy shared with the inbox page. Successful sends
  // appear in the thread; failures still need a notice.
  "request-nothing": { form: "reply", tone: "warning", key: "assistsFront.inbox.requestNothing" },
  "request-draft-exists": {
    form: "reply",
    tone: "warning",
    key: "assistsFront.inbox.requestDraftExists",
  },
  "reply-sent": { form: "reply", tone: "success", silent: true },
  "reply-send-failed": { form: "reply", tone: "danger", key: "inbox.notices.failed" },
  "reply-not-configured": { form: "reply", tone: "warning", key: "inbox.notices.notConfigured" },
  "reply-empty-body": { form: "reply", tone: "danger", key: "inbox.notices.emptyBody" },
  "reply-body-too-long": { form: "reply", tone: "danger", key: "inbox.notices.tooLong" },
  "reply-message-not-found": { form: "reply", tone: "danger", key: "inbox.notices.notFound" },
  "reply-send-limit": { form: "reply", tone: "warning", ...sendLimitWords("replies") },
  "reply-channel-unsupported": {
    form: "reply",
    tone: "danger",
    key: "inbox.notices.channelUnsupported",
  },
  "reply-no-reply-address": { form: "reply", tone: "danger", key: "inbox.notices.noReplyAddress" },
  // An address exists, but no sendable reply can be built.
  "reply-cannot-be-sent": { form: "reply", tone: "danger", key: "inbox.notices.cannotBeSent" },
  "reply-whatsapp-window-closed": {
    form: "reply",
    tone: "danger",
    key: "inbox.notices.whatsappWindowClosed",
  },
  "reply-whatsapp-not-connected": {
    form: "reply",
    tone: "danger",
    key: "inbox.notices.whatsappNotConnected",
  },
  "not-authorized-reply": { form: "reply", tone: "danger", key: "inbox.notices.notAuthorized" },
  // Successful requests appear in the thread and composer.
  "reopen-sent": { form: "reply", tone: "success", silent: true },
  "reopen-send-failed": { form: "reply", tone: "danger", key: "inbox.notices.reopenFailed" },
  "reopen-send-limit": { form: "reply", tone: "warning", ...sendLimitWords("replies") },
  "reopen-message-not-found": { form: "reply", tone: "danger", key: "inbox.notices.notFound" },
  "reopen-whatsapp-window-open": {
    form: "reply",
    tone: "warning",
    key: "inbox.notices.reopenWindowOpen",
  },
  "reopen-already-asked": {
    form: "reply",
    tone: "warning",
    key: "inbox.notices.reopenAlreadyAsked",
  },
  "reopen-whatsapp-not-connected": {
    form: "reply",
    tone: "danger",
    key: "inbox.notices.whatsappNotConnected",
  },

  // A successful merge may remove the candidate panel, so its confirmation is
  // page-level; refusals remain beside the survivor choice.
  merged: { form: "page", tone: "success", key: "divers.notices.merged" },
  "not-authorized-merge": {
    form: "page",
    tone: "danger",
    key: "divers.notices.notAuthorizedMerge",
  },
  "merge-invalid": { form: "merge", tone: "danger", key: "divers.notices.mergeInvalid" },
  "merge-anonymized": {
    form: "merge",
    tone: "danger",
    key: "divers.notices.mergeAnonymized",
  },
  "merge-already-merged": {
    form: "merge",
    tone: "danger",
    key: "divers.notices.mergeAlreadyMerged",
  },
  "merge-already-removed": {
    form: "merge",
    tone: "danger",
    key: "divers.notices.mergeAlreadyRemoved",
  },
  "merge-staff-record": {
    form: "merge",
    tone: "danger",
    key: "divers.notices.mergeStaffRecord",
  },
  "merge-booking-conflict": {
    form: "merge",
    tone: "danger",
    key: "divers.notices.mergeBookingConflict",
  },
  "merge-record-conflict": {
    form: "merge",
    tone: "danger",
    key: "divers.notices.mergeRecordConflict",
  },
  "merge-different-people-unacknowledged": {
    form: "merge",
    tone: "danger",
    key: "divers.notices.mergeDifferentPeopleUnacknowledged",
  },
  "merge-departure-underway": {
    form: "merge",
    tone: "danger",
    key: "divers.notices.mergeDepartureUnderway",
  },
  "merge-assessment-changed": {
    form: "merge",
    tone: "danger",
    key: "divers.notices.mergeAssessmentChanged",
  },
  // The target was merged away before this write was handled.
  "merged-record-moved": {
    form: "page",
    tone: "warning",
    key: "divers.notices.mergedRecordMoved",
  },

  // Book an activity. Every code below is emitted only by the seating path, so
  // none of them needs an explicit `?form=` to find its way home.
  booked: { form: "book", tone: "success", key: "divers.notices.booked" },
  "booked-confirmed": { form: "book", tone: "success", key: "divers.notices.bookedConfirmed" },
  "booked-waiver-undelivered": {
    form: "book",
    tone: "warning",
    key: "divers.notices.bookedWaiverUndelivered",
  },
  // This door names an existing person; retain the hold notice because
  // `createBooking` decides whether the seat is unconfirmed.
  "booked-identity-unconfirmed": {
    form: "book",
    tone: "warning",
    key: "divers.notices.bookedIdentityUnconfirmed",
  },
  "trip-full": { form: "book", tone: "danger", key: "divers.notices.tripFull" },
  "divers-full": { form: "book", tone: "danger", key: "participants.notices.diversFull" },
  "type-unavailable": {
    form: "book",
    tone: "danger",
    key: "participants.notices.typeUnavailable",
  },
  "already-booked": { form: "book", tone: "danger", key: "divers.notices.alreadyBooked" },
  "course-unstaffed": {
    form: "book",
    tone: "danger",
    key: "divers.notices.courseUnstaffed",
  },
  "course-prerequisite": {
    form: "book",
    tone: "danger",
    key: "divers.notices.coursePrerequisite",
  },
  "course-ratio-full": {
    form: "book",
    tone: "danger",
    key: "divers.notices.courseRatioFull",
  },
  "course-min-age": { form: "book", tone: "danger", key: "divers.notices.courseMinAge" },
  "trip-prerequisite": {
    form: "book",
    tone: "danger",
    key: "divers.notices.tripPrerequisite",
  },
  "trip-unavailable": {
    form: "book",
    tone: "danger",
    key: "divers.notices.tripUnavailable",
  },
  "booking-invalid": {
    form: "book",
    tone: "danger",
    key: "divers.notices.bookingInvalid",
  },
  "seat-busy": { form: "book", tone: "danger", key: "seatDiver.busy" },

  // Removal, restore, erasure — each beside its own control.
  deleted: { form: "remove", tone: "success", key: "divers.notices.deleted" },
  "not-authorized-delete": {
    form: "remove",
    tone: "danger",
    key: "divers.notices.notAuthorizedDelete",
  },
  "remove-crew-upcoming": {
    form: "remove",
    tone: "warning",
    key: "divers.notices.removeCrewUpcoming",
  },
  // Restoring removes the restore card, so its confirmation is page-level.
  restored: { form: "page", tone: "success", key: "divers.notices.restored" },
  // On refusal the diver remains removed, so the restore card remains visible.
  "restore-refused": { form: "restore", tone: "danger", key: "divers.notices.restoreRefused" },
  "not-authorized-erase": {
    form: "erase",
    tone: "danger",
    key: "divers.notices.notAuthorizedErase",
  },
  "erase-name-mismatch": {
    form: "erase",
    tone: "danger",
    key: "divers.notices.eraseNameMismatch",
    field: "erase-confirm-name",
  },
  "erase-refused": { form: "erase", tone: "danger", key: "divers.notices.eraseRefused" },
  // Removing the last address removes its section, so success is page-level.
  "guardian-email-erased": {
    form: "page",
    tone: "success",
    key: "divers.notices.guardianEmailErased",
  },
  "guardian-email-mismatch": {
    form: "guardian-email",
    tone: "danger",
    key: "divers.notices.guardianEmailMismatch",
  },
  "guardian-email-not-found": {
    form: "guardian-email",
    tone: "danger",
    key: "divers.notices.guardianEmailNotFound",
  },
  "not-authorized-guardian-email": {
    form: "guardian-email",
    tone: "danger",
    key: "divers.notices.notAuthorizedGuardianEmail",
  },
  // Service reminder settings appear beside the pieces they affect.
  "reminders-off": {
    form: "work-orders",
    tone: "success",
    key: "benchFollowUp.notice.remindersOff",
  },
  "reminders-on": { form: "work-orders", tone: "success", key: "benchFollowUp.notice.remindersOn" },
  "reminders-not-found": {
    form: "work-orders",
    tone: "danger",
    key: "workOrders.notice.notFound",
  },
  // Erasure is offered on a deleted record only, and the action enforces it —
  // so this arrives on a record whose erase section is not rendered. `"page"`
  // is the only place it can be seen, and it happens to be directly above the
  // Delete control it is asking for.
  "erase-requires-delete": {
    form: "page",
    tone: "danger",
    key: "divers.notices.eraseRequiresDelete",
  },

  // Routed to the details form, where the page renders this earned moment.
  "diver-clear": { form: "details", tone: "success", key: "divers.notices.cleared" },

  // Emitted by half a dozen actions, so it has no single home of its own; each
  // one stamps a `?form=` and this default is only reached without one.
  invalid: { form: "page", tone: "danger", key: "divers.notices.invalid" },
};

/**
 * Allowed form names for notice routing. Unknown query values fall back to the
 * notice code's default form.
 */
const DIVER_FORMS = new Set([
  "page",
  "details",
  "cards",
  "waiver",
  "fit",
  "story",
  "book",
  "notes",
  "merge",
  "remove",
  "restore",
  "erase",
  "guardian-email",
]);

function diverNoticeForm(param: string | undefined, fallback: string): string {
  return param !== undefined && DIVER_FORMS.has(param) ? param : fallback;
}

/**
 * A resolved diver-record notice: the shared `{form, tone, text}` plus the two
 * things this page's notices carry that the shared shape does not — a link to
 * the screen that fixes it, and the id of the control it belongs on.
 */
/** The one code with somewhere to send someone. */
const NOTICE_LINKS: Record<string, NoticeLink> = {
  "payment-not-connected": {
    key: "shared.payments.connect",
    href: (shopSlug) => `/shop/${shopSlug}/settings#money`,
  },
};

export type DiverNotice = FormNotice & {
  /** Where the refusal can be fixed, when it names somewhere. */
  link?: NoticeLink;
  /**
   * The `?notice=` code itself, so a surface can recognise the one outcome
   * that is not a sentence in a status row — `diver-clear`, the record's
   * earned moment (ADR 20260827-clearwater-surface-language, decision 11).
   */
  code?: string;
  field?: string;
  /**
   * Which card's box the refusal belongs on, when the code names a box at all.
   *
   * A diver can hold more than one self-declared card, and `field` alone says
   * only *which kind* of box — so `card-number-implausible` opened every
   * sighting disclosure on the record and printed the same red sentence under
   * each, including the ones nobody had typed in. The action carries the id it
   * refused (`?card=`), and the group compares.
   */
  cardId?: string;
  silent?: true;
};

/**
 * Resolves a notice code to its message and owning form. Unclaimed notices
 * remain available to the page-level banner.
 */
export function resolveDiverNotice({
  notice,
  form,
  gate,
  card,
  personId,
  locale,
  canRaiseInvoice = false,
  conflictDeparture,
  personName,
}: {
  notice?: string;
  /**
   * Form override for codes emitted by more than one form.
   */
  form?: string;
  /**
   * Signed refusal detail for `trip-prerequisite`. It is verified against this
   * record's person id before use; absent or invalid signatures use generic
   * copy. Repeated query parameters arrive as an array.
   */
  gate?: string | string[];
  /** The card the refusal is about, for a code that names a box (`?card=`). */
  card?: string;
  /**
   * Person id from the path. The signed gate is bound to this id.
   */
  personId: string;
  /** The stored name from this record, never a query parameter. */
  personName?: string;
  locale: string;
  /**
   * Whether this reader can raise an invoice. Defaults to false.
   */
  canRaiseInvoice?: boolean;
  /**
   * Formatted departure detail for `merge-booking-conflict`.
   */
  conflictDeparture?: string;
}): DiverNotice | undefined {
  const banner = noticeFromParam(notice, NOTICE_KEYS);
  if (!banner) return undefined;
  const t = staffTranslator(locale);
  const refusal =
    notice === "trip-prerequisite"
      ? verifyTripAdmissionGate(gate, { kind: "diver", id: personId })
      : null;
  return {
    form: diverNoticeForm(form, banner.form),
    tone: banner.tone,
    text: banner.silent
      ? ""
      : notice === "diver-clear"
        ? t("divers.notices.cleared", {
            name: personName?.trim() || t("shared.waiverSend.unnamedDiver"),
          })
        : refusal
          ? tripAdmissionRefusalText(t, refusal, locale)
          : notice === "booked" && !canRaiseInvoice
            ? t("divers.notices.bookedNoInvoice")
            : notice === "booked-confirmed" && !canRaiseInvoice
              ? t("divers.notices.bookedConfirmedNoInvoice")
              : notice === "merge-booking-conflict" && conflictDeparture
                ? t("divers.notices.mergeBookingConflictOn", { departure: conflictDeparture })
                : t(banner.key as StaffMessageKey, banner.values),
    code: notice,
    link: notice === undefined ? undefined : NOTICE_LINKS[notice],
    field: banner.field,
    // Only ever paired with a `field`: an id on a notice that names no box has
    // nothing to compare against and would read as one that does.
    cardId: banner.field ? card : undefined,
    silent: banner.silent,
  };
}
