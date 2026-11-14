import type {
  ArrivalOfflineRefusal,
  CheckInOutcome,
  UndoCheckInOutcome,
} from "@/features/check-in";
import type { MarkNoShowOutcome, UndoNoShowOutcome } from "@/features/no-show";
import type { TurnAwayOutcome } from "@/features/turn-away";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { type FormNotice, type NoticeCodeOf, noticeFromParam } from "@/lib/staff-notices";

/** Desk URL codes derived from the outcome unions. Offline refusals belong to
 * queued-device reconciliation; no-show and turn-away codes are prefixed to
 * keep their meanings distinct. Paper-waiver outcomes stay with their form.
 */
type CheckInRefusal = Extract<CheckInOutcome, { ok: false }>["reason"];
type UndoRefusal = Extract<UndoCheckInOutcome, { ok: false }>["reason"];
type MarkNoShowRefusal = Extract<MarkNoShowOutcome, { ok: false }>["reason"];
type UndoNoShowRefusal =
  | Extract<UndoNoShowOutcome, { ok: false }>["reason"]
  | Extract<UndoNoShowOutcome, { state: "conflict" }>["conflict"]
  | "pending";
type TurnAwayRefusal = Extract<TurnAwayOutcome, { ok: false }>["reason"];
type DeskNoticeCode = NoticeCodeOf<
  | Exclude<CheckInRefusal | Exclude<UndoRefusal, "not_checked_in">, ArrivalOfflineRefusal>
  | `no_show_${MarkNoShowRefusal | UndoNoShowRefusal}`
  | `turn_away_${TurnAwayRefusal}`
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
 * 9). Every code here is a refusal or an outcome with no row state to land on.
 */
export const DESK_NOTICES: DeskNoticeMap = {
  "not-ready": { tone: "warning", key: "checkIn.notice.notReady" },
  "not-bookable": { tone: "danger", key: "checkIn.notice.notBookable" },
  // Idempotent outcome: the diver is already in the requested state.
  "already-checked-in": { tone: "neutral", key: "checkIn.notice.alreadyCheckedIn" },
  "not-found": { tone: "danger", key: "checkIn.notice.notFound" },
  "staff-not-found": { tone: "danger", key: "checkIn.notice.staffNotFound" },
  invalid: { tone: "danger", key: "checkIn.notice.invalid" },
  // These outcomes distinguish boarded from not-back-aboard roll call states.
  "no-show-already-boarded": { tone: "danger", key: "checkIn.notice.noShowAlreadyBoarded" },
  "no-show-already-missing-after-dive": {
    tone: "danger",
    key: "checkIn.notice.noShowAlreadyMissingAfterDive",
  },
  "no-show-already-marked": { tone: "neutral", key: "checkIn.notice.noShowAlreadyMarked" },
  "no-show-not-booked": { tone: "neutral", key: "checkIn.notice.noShowNotBooked" },
  "no-show-trip-cancelled": { tone: "neutral", key: "checkIn.notice.noShowTripCancelled" },
  "no-show-divers-full": { tone: "warning", key: "participants.notices.noShowDiversFull" },
  "no-show-before-departure": { tone: "warning", key: "checkIn.notice.noShowBeforeDeparture" },
  "no-show-window-closed": { tone: "warning", key: "checkIn.notice.noShowWindowClosed" },
  "no-show-not-marked": { tone: "neutral", key: "checkIn.notice.noShowNotMarked" },
  // Recorded; the departure was busy, and the seat comes back after the response.
  "no-show-pending": { tone: "neutral", key: "checkIn.notice.noShowPending" },
  "no-show-key-reused": { tone: "danger", key: "checkIn.notice.invalid" },
  // Recorded and open: the seat was resold before the tap, so it waits for the next one.
  "no-show-trip-full": { tone: "warning", key: "checkIn.notice.noShowTripFull" },
  "no-show-seat-moved": { tone: "warning", key: "checkIn.notice.noShowSeatMoved" },
  "no-show-seat-cancelled": { tone: "warning", key: "checkIn.notice.noShowSeatCancelled" },
  "no-show-diver-erased": { tone: "neutral", key: "checkIn.notice.notFound" },
  "no-show-course-ratio-full": { tone: "danger", key: "checkIn.notice.noShowCourseRatioFull" },
  "no-show-course-unstaffed": { tone: "danger", key: "checkIn.notice.noShowCourseUnstaffed" },
  "no-show-course-prerequisite": {
    tone: "danger",
    key: "checkIn.notice.noShowCoursePrerequisite",
  },
  "no-show-course-min-age": { tone: "danger", key: "checkIn.notice.noShowCourseMinAge" },
  "no-show-not-found": { tone: "danger", key: "checkIn.notice.notFound" },
  "no-show-staff-not-found": { tone: "danger", key: "checkIn.notice.staffNotFound" },
  // The departure started after the diver was turned away.
  "no-show-turned-away-departed": {
    tone: "warning",
    key: "checkIn.notice.noShowTurnedAwayDeparted",
  },
  // Turn-away outcomes distinguish roll-call state and row changes.
  "turn-away-already-boarded": { tone: "danger", key: "checkIn.notice.turnAwayAlreadyBoarded" },
  "turn-away-already-missing-after-dive": {
    tone: "danger",
    key: "checkIn.notice.noShowAlreadyMissingAfterDive",
  },
  "turn-away-already-marked": { tone: "neutral", key: "checkIn.notice.turnAwayAlreadyMarked" },
  // The boat left after this diver checked in.
  "turn-away-sailed": { tone: "danger", key: "checkIn.notice.turnAwaySailed" },
  "turn-away-not-booked": { tone: "neutral", key: "checkIn.notice.noShowNotBooked" },
  "turn-away-trip-cancelled": { tone: "neutral", key: "checkIn.notice.noShowTripCancelled" },
  "turn-away-outside-window": { tone: "warning", key: "checkIn.notice.turnAwayOutsideWindow" },
  "turn-away-not-blocked": { tone: "warning", key: "checkIn.notice.turnAwayNotBlocked" },
  "turn-away-reason-not-blocking": {
    tone: "warning",
    key: "checkIn.notice.turnAwayReasonNotBlocking",
  },
  "turn-away-not-found": { tone: "danger", key: "checkIn.notice.notFound" },
  "turn-away-staff-not-found": { tone: "danger", key: "checkIn.notice.staffNotFound" },
  // Rebooking offer delivery outcomes.
  "offer-sent": { tone: "success", key: "checkIn.notice.offerSent" },
  "offer-already-sent": { tone: "neutral", key: "checkIn.notice.offerAlreadySent" },
  "offer-not-sent": { tone: "warning", key: "checkIn.notice.offerNotSent" },
  "offer-opted-out": { tone: "warning", key: "checkIn.notice.offerOptedOut" },
  "offer-unavailable": { tone: "neutral", key: "checkIn.notice.offerUnavailable" },
};

/**
 * The desk's own refusals and walk-in outcomes, as the trip page's banner
 * notice: page-level, because they have no form on the roster to sit beside.
 * The page asks only after the roster's own vocabulary declined the code, so a
 * code both speak is the roster's.
 */
export function deskFormNotice(
  notice: string | undefined,
  t: StaffTranslator,
): FormNotice | undefined {
  const definition = noticeFromParam(notice, DESK_NOTICES);
  return definition ? { form: "page", tone: definition.tone, text: t(definition.key) } : undefined;
}
