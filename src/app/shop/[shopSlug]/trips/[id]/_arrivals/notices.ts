import type { ArrivalOfflineRefusal, CheckInOutcome, UndoCheckInOutcome } from "@/db/check-in";
import type { MarkNoShowOutcome, UndoNoShowOutcome } from "@/db/no-show";
import type { StaffMessageKey } from "@/i18n/staff-messages";
import type { NoticeCodeOf } from "@/lib/staff-notices";

/**
 * **What the desk's taps and the walk-in door can answer with**, in the
 * spelling that reaches the Divers tab's URL.
 *
 * Derived from the domain unions rather than listed, so **a refusal added to
 * either union with no words below is a compile error**. The reverse — an entry
 * left behind after a reason is deleted — is not caught, because the map also
 * carries codes from a vocabulary the desk only borrows (`SEAT_SURFACES
 * ["walk-in"]`). A guard claimed to be stronger than it
 * is gets trusted where it does not hold.
 *
 * `ArrivalOfflineRefusal` is excluded: those answer a device reconciling a
 * queued tap, never a staffer at the desk. The no-show refusals arrive prefixed
 * (`no_show_…`) so "not found" cannot mean two rows at once (issue #1209).
 *
 * The paper-release refusals are not here: the roster's own control records a
 * paper waiver and answers in its form (`TripNoticeBanner`'s `waiver-*`).
 */
type CheckInRefusal = Extract<CheckInOutcome, { ok: false }>["reason"];
type UndoRefusal = Extract<UndoCheckInOutcome, { ok: false }>["reason"];
type MarkNoShowRefusal = Extract<MarkNoShowOutcome, { ok: false }>["reason"];
type UndoNoShowRefusal = Extract<UndoNoShowOutcome, { ok: false }>["reason"];
type DeskNoticeCode = NoticeCodeOf<
  | Exclude<CheckInRefusal | Exclude<UndoRefusal, "not_checked_in">, ArrivalOfflineRefusal>
  | `no_show_${MarkNoShowRefusal | UndoNoShowRefusal}`
>;

export type DeskNotice = {
  tone: "success" | "danger" | "warning" | "neutral";
  key: StaffMessageKey;
};

/** Loose in the keys it accepts, exact in the ones it demands. */
type DeskNoticeMap = Record<string, DeskNotice> & Record<DeskNoticeCode, DeskNotice>;

/**
 * No success entries for checking in or undoing one: the row itself settles
 * into (or out of) "Checked in" beside the tap that did it (design principle
 * 9). Every code here is a refusal or a walk-in outcome with no row state to
 * land on.
 */
export const DESK_NOTICES: DeskNoticeMap = {
  "not-ready": { tone: "warning", key: "checkIn.notice.notReady" },
  "not-bookable": { tone: "danger", key: "checkIn.notice.notBookable" },
  // Neutral, not a refusal: a diver already checked in is in the state the
  // staffer wanted. `checkInBooking` answers this with idempotent success
  // today; it is here because the reason is still in its union.
  "already-checked-in": { tone: "neutral", key: "checkIn.notice.alreadyCheckedIn" },
  "not-found": { tone: "danger", key: "checkIn.notice.notFound" },
  "staff-not-found": { tone: "danger", key: "checkIn.notice.staffNotFound" },
  invalid: { tone: "danger", key: "checkIn.notice.invalid" },
  "walkin-added": { tone: "success", key: "checkIn.notice.walkinAdded" },
  // The walk-in's *ordinary* outcome: added on a name alone, there is no
  // address to mail a waiver to, so the notice says the link is still owed.
  "walkin-added-waiver-undelivered": {
    tone: "warning",
    key: "checkIn.notice.walkinAddedWaiverUndelivered",
  },
  // The name-match prompt hands the seat an existing diver's record on a
  // guess, held until somebody confirms it (H-13, issue #1556).
  "walkin-added-identity-unconfirmed": {
    tone: "warning",
    key: "checkIn.notice.walkinAddedIdentityUnconfirmed",
  },
  // The two roll-call refusals say different sentences because the desk's next
  // act differs: the crew boarded this diver, or recorded them not back aboard.
  "no-show-already-boarded": { tone: "danger", key: "checkIn.notice.noShowAlreadyBoarded" },
  "no-show-already-missing-after-dive": {
    tone: "danger",
    key: "checkIn.notice.noShowAlreadyMissingAfterDive",
  },
  "no-show-already-marked": { tone: "neutral", key: "checkIn.notice.noShowAlreadyMarked" },
  "no-show-not-booked": { tone: "neutral", key: "checkIn.notice.noShowNotBooked" },
  "no-show-trip-cancelled": { tone: "neutral", key: "checkIn.notice.noShowTripCancelled" },
  "no-show-divers-full": { tone: "danger", key: "participants.notices.noShowDiversFull" },
  "no-show-before-departure": { tone: "warning", key: "checkIn.notice.noShowBeforeDeparture" },
  "no-show-window-closed": { tone: "warning", key: "checkIn.notice.noShowWindowClosed" },
  "no-show-not-marked": { tone: "neutral", key: "checkIn.notice.noShowNotMarked" },
  // The seat was resold between the mark and the Undo.
  "no-show-trip-full": { tone: "danger", key: "checkIn.notice.noShowTripFull" },
  "no-show-course-ratio-full": { tone: "danger", key: "checkIn.notice.noShowCourseRatioFull" },
  "no-show-not-found": { tone: "danger", key: "checkIn.notice.notFound" },
  "no-show-staff-not-found": { tone: "danger", key: "checkIn.notice.staffNotFound" },
};
