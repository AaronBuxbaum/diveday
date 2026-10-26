import type { ActivityCode } from "./activity";

/**
 * **The shop's activity log, as a domain** — what each line is about, and the
 * filters an owner reads it through (D5, `src/db/shop-activity.ts`).
 *
 * The log is a read model over the append-only trails the product already
 * keeps, not a trail of its own: `activity_events` (seats, crew, notes,
 * refunds, the board), `review_moderation_events` (who published or hid a
 * review) and `trip_change_events` (who moved a meeting point or posted
 * conditions). This module names the kinds those lines fall into, so the
 * filter an owner picks ("Money") is one code here and one list of codes, never
 * a sentence (ADR 20260731-domain-layer-copy-leaks).
 */

/** The six things a line can be about, in the filter's order. */
export const SHOP_ACTIVITY_KINDS = [
  "seats",
  "departures",
  "money",
  "safety",
  "records",
  "reviews",
] as const;

export type ShopActivityKind = (typeof SHOP_ACTIVITY_KINDS)[number];

export function isShopActivityKind(value: unknown): value is ShopActivityKind {
  return (SHOP_ACTIVITY_KINDS as readonly unknown[]).includes(value);
}

/**
 * Which kind each `activity_events` code files under. **Total by
 * construction**: keyed by the code union, so a new code cannot reach the log
 * without being placed, and the filter can never quietly drop it.
 *
 * `participant_type_changed` is `safety` rather than `seats` because it is the
 * line that answers "who wrote a seat past a missing card" — the change is the
 * one door that clears a card block, and its line says so. An erased line
 * (`redacted`) is a record of the erasure, so it files under `records`.
 */
export const ACTIVITY_CODE_KINDS: Record<ActivityCode, ShopActivityKind> = {
  counter_check_in: "seats",
  counter_check_in_undone: "seats",
  booking_removed: "seats",
  booking_restored: "seats",
  booking_no_show: "seats",
  booking_no_show_undone: "seats",
  booking_no_show_undo_refused: "seats",
  booking_no_show_boarded: "seats",
  booking_no_show_missing_after_dive: "seats",
  booking_turned_away: "safety",
  seat_added: "seats",
  seat_added_walk_in: "seats",
  seat_added_from_trip_link: "seats",
  departure_offered: "seats",
  rider_added_at_dock: "seats",
  seat_moved_away: "seats",
  seat_moved_here: "seats",
  departure_note_sent: "departures",
  booking_link_requested: "seats",
  seat_claimed: "seats",
  seat_self_cancelled: "seats",
  seat_holder_cancelled: "seats",
  party_seat_self_cancelled: "seats",
  participant_type_changed: "safety",
  course_form_medical_changed: "safety",
  training_dive_marked: "safety",
  training_dive_cleared: "safety",
  identity_confirmed: "safety",
  identity_split: "safety",
  identity_split_off: "safety",
  identity_repointed: "safety",
  identity_repointed_off: "safety",
  identity_repointed_onto: "safety",
  medical_clearance_opened: "safety",
  diver_medical_form_opened: "safety",
  medical_diver_form_accepted: "safety",
  medical_diver_form_not_used: "safety",
  medical_answered_by_earlier_letter: "safety",
  medical_answers_read: "safety",
  medical_alert_read: "safety",
  medical_alert_saved_offline: "safety",
  medical_alert_printed: "safety",
  medical_alert_emergency_read: "safety",
  date_of_birth_cleared_as_adult: "safety",
  incident_report_filed: "safety",
  incident_report_addendum_added: "safety",
  incident_draft_discarded: "safety",
  incident_legal_hold_set: "safety",
  incident_legal_hold_released: "safety",
  missing_diver_alert_raised: "safety",
  missing_diver_found: "safety",
  crew_assigned: "departures",
  crew_removed: "departures",
  blowout_called: "departures",
  departure_added: "departures",
  series_added: "departures",
  departure_moved: "departures",
  departure_boat_changed: "departures",
  departure_copied: "departures",
  departure_deleted: "departures",
  departure_retitled_by_erasure: "departures",
  series_cancelled: "departures",
  departure_called_off_automatically: "departures",
  review_replied: "reviews",
  review_reply_edited: "reviews",
  review_reply_deleted: "reviews",
  shore_alert_contact_set: "safety",
  boat_papers_changed: "safety",
  shore_alert_contact_changed: "safety",
  shore_alert_contact_cleared: "safety",
  shore_alert_contact_stopped: "safety",
  bookkeeper_email_set: "records",
  bookkeeper_email_changed: "records",
  bookkeeper_email_cleared: "records",
  bookkeeper_email_vouched: "records",
  bookkeeper_email_stopped: "records",
  order_refunded: "money",
  order_paid_cash: "money",
  order_paid_card_machine: "money",
  order_paid_room_charge: "money",
  counter_payment_not_recorded: "money",
  counter_payment_not_recorded_paid_online: "money",
  paid_after_close_refunded: "money",
  seat_refunded: "money",
  seat_self_refunded: "money",
  seat_holder_refunded: "money",
  party_seat_self_refunded: "money",
  payment_waived: "money",
  payment_marked_refunded: "money",
  payment_balance_written_off: "money",
  party_marked_paid: "money",
  dashboard_refund_matched: "money",
  note_added: "records",
  note_deleted: "records",
  record_exported: "records",
  drysuit_experience_recorded: "records",
  drysuit_experience_cleared: "records",
  dispute_sheet_printed: "records",
  integration_backfill_sent: "records",
  running_late_from_message: "seats",
  diver_merged: "records",
  redacted: "records",
  demo_charter_confirmed: "departures",
  demo_second_dive_moved: "departures",
  demo_tanks_counted: "departures",
  demo_crew_briefed: "departures",
  demo_deposit_taken: "money",
  demo_release_sent: "seats",
  demo_release_returned: "seats",
  demo_card_checked: "safety",
  demo_kit_reserved: "seats",
  demo_called_about_time: "seats",
  demo_moved_to_second_boat: "seats",
  demo_briefing_walked: "seats",
  demo_balance_taken: "money",
  demo_driving_noted: "seats",
  demo_bcd_swapped: "seats",
  demo_nitrox_logged: "safety",
  demo_own_computer_confirmed: "seats",
  demo_paper_card_reminded: "seats",
};

/** The `activity_events` codes one kind covers, for the reader's `code in (…)`. */
export function activityCodesOfKind(kind: ShopActivityKind): ActivityCode[] {
  return (Object.keys(ACTIVITY_CODE_KINDS) as ActivityCode[]).filter(
    (code) => ACTIVITY_CODE_KINDS[code] === kind,
  );
}

/**
 * Where a line came from. `activity` is an `activity_events` row; the other
 * two are the trails whose rows already name their author.
 */
export type ShopActivitySource = "activity" | "review" | "trip_change";

/** A review moderation act, as `review_moderation_events.action` stores it. */
export type ReviewModerationLineCode = "published" | "hidden";

/**
 * A departure plan change, as `trip_change_events.kind` stores it. Every
 * value of that enum, which `activity-labels.test.ts` holds this to, so a
 * kind added there cannot reach the log as "unknown" (review of #3061).
 */
export type TripChangeLineCode = "meeting_point" | "conditions" | "site_change";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A `?from=`/`?to=` value as a calendar day, or nothing. A malformed value is
 * not a filter — never a thrown error over a stray query parameter.
 */
export function shopActivityDay(
  value: string | undefined,
): { year: number; month: number; day: number } | null {
  const match = value ? DAY.exec(value) : null;
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}
