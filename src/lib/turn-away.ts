import { arrivalsWindow } from "./operational-window";
import type { ReadinessBlocker, ReadinessBlockerCode, ReadinessResult } from "./readiness";

/**
 * **"Turned away" at the desk** (safety sheet 2026-10-15, item 6; H-124).
 *
 * A diver the desk saw and would not board used to have one door, "Not here",
 * which records that they did not arrive. An insurer reading that line about
 * somebody the desk stood in front of and refused reads the opposite of what
 * happened. This module is the gate in front of the second statement: the
 * diver was seen, they could not board, and this is why.
 *
 * **The reason is a category, never the evidence.** It is chosen from the
 * row's own readiness blockers, so a staffer can only say what readiness
 * already says, and it is stored as one word (`card`, `waiver`, `medical`…).
 * A medical answer or a card number never reaches the column, the trail or the
 * export: the category is the whole record.
 *
 * **Any active staff member, blocked rows only** (H-124). The system already
 * refuses this diver's boarding, so recording why is no new power; it frees the
 * seat at once with the same capacity effect as a no-show, and "Put back on the
 * list" takes it back.
 *
 * Codes only — the words live in the staff bundle (ADR
 * 20260731-domain-layer-copy-leaks).
 */

/** Kept in step with the `turn_away_reason` pg enum (src/db/schema/bookings.ts). */
export const TURN_AWAY_REASONS = [
  "medical",
  "waiver",
  "card",
  "age",
  "identity",
  "payment",
] as const;

export type TurnAwayReason = (typeof TURN_AWAY_REASONS)[number];

export function isTurnAwayReason(value: string): value is TurnAwayReason {
  return (TURN_AWAY_REASONS as readonly string[]).includes(value);
}

/**
 * Which reason each blocker lets the desk give. **Total by construction**, so a
 * new blocker code is a compile error here until somebody decides it.
 *
 * `null` is a blocker that says nothing about the diver: the shop never set the
 * departure's requirements, or the readiness lookup failed. Neither is a reason
 * to send a person home, so neither is offered.
 *
 * `medical` is its own reason rather than folded into `waiver`, because at the
 * desk it is a different conversation (a doctor's sign-off, not a signature),
 * and it is the word a staffer needs to see on the record afterwards. Only the
 * word: the answers stay on the release.
 */
const REASON_FOR_BLOCKER: Record<ReadinessBlockerCode, TurnAwayReason | null> = {
  requirements_not_configured: null,
  readiness_unavailable: null,
  identity_unconfirmed: "identity",
  waiver_not_sent: "waiver",
  waiver_lapsed: "waiver",
  waiver_pending: "waiver",
  waiver_expired: "waiver",
  guardian_signature_missing: "waiver",
  course_form_unsigned: "waiver",
  course_form_guardian_missing: "waiver",
  medical_review: "medical",
  medical_not_cleared: "medical",
  certification_missing: "card",
  certification_pending: "card",
  certification_self_declared: "card",
  certification_insufficient: "card",
  certification_in_training: "card",
  certification_not_yet: "card",
  specialty_missing: "card",
  specialty_pending: "card",
  specialty_import_unconfirmed: "card",
  nitrox_missing: "card",
  nitrox_pending: "card",
  nitrox_self_declared: "card",
  under_minimum_age: "age",
  payment_due: "payment",
  payment_refunded: "payment",
};

/**
 * The reasons this row's own blockers allow, in `TURN_AWAY_REASONS` order and
 * without repeats. Empty for a ready row, and for a row blocked only by shop
 * setup or a failed lookup.
 */
export function turnAwayReasons(readiness: {
  status: ReadinessResult["status"];
  blockers: readonly ReadinessBlocker[];
}): TurnAwayReason[] {
  if (readiness.status === "ready") return [];
  const allowed = new Set(
    readiness.blockers.map((blocker) => REASON_FOR_BLOCKER[blocker.code]).filter(Boolean),
  );
  return TURN_AWAY_REASONS.filter((reason) => allowed.has(reason));
}

/**
 * Whether the desk may record this diver as turned away for this reason, or
 * why not.
 *
 * - `already_boarded` / `already_missing_after_dive` — the crew's roll call
 *   puts this diver on the water. The same refusal, first and for the same
 *   reason, as `noShowGate` (src/lib/no-show.ts): nothing at the desk may take
 *   a person the manifest is holding off the expected list.
 * - `already_marked` — the seat is already released (turned away, or marked
 *   not here). The seat is freed once.
 * - `not_booked` — the seat was given up.
 * - `trip_cancelled` — the boat is not going.
 * - `outside_window` — the departure is outside the counter's own reach
 *   (`arrivalsWindow`); a correction there belongs on the booking.
 * - `not_blocked` — readiness clears this diver, so there is nothing to turn
 *   them away for (H-124: blocked rows only).
 * - `reason_not_blocking` — the reason given is not one of this row's own
 *   blockers.
 *
 * **Open before the boat's start time**, unlike "Not here": the desk can see
 * the diver now, so "turned away" is a statement, not a guess.
 */
export type TurnAwayGate =
  | "eligible"
  | "already_boarded"
  | "already_missing_after_dive"
  | "already_marked"
  | "not_booked"
  | "trip_cancelled"
  | "outside_window"
  | "not_blocked"
  | "reason_not_blocking";

export type TurnAwayGateInput = {
  bookingStatus: string;
  /** As `NoShowGateInput.onTheWater`: `onTheWaterByRollCall` (src/db/manifests.ts). */
  onTheWater: "boarded" | "missing_after_dive" | null;
  tripStatus: "scheduled" | "cancelled";
  startsAt: Date;
  now: Date;
  /** Live readiness, re-read by the writer under the seat's lock. */
  readiness: { status: ReadinessResult["status"]; blockers: readonly ReadinessBlocker[] };
  reason: TurnAwayReason;
};

export function turnAwayGate(input: TurnAwayGateInput): TurnAwayGate {
  // Safety first, ahead of every other condition so none of them can mask it.
  if (input.onTheWater === "boarded") return "already_boarded";
  if (input.onTheWater === "missing_after_dive") return "already_missing_after_dive";
  if (input.bookingStatus === "no_show") return "already_marked";
  if (input.bookingStatus !== "booked" && input.bookingStatus !== "checked_in") {
    return "not_booked";
  }
  if (input.tripStatus === "cancelled") return "trip_cancelled";
  const window = arrivalsWindow(input.now);
  if (input.startsAt < window.from || input.startsAt > window.to) return "outside_window";
  if (input.readiness.status === "ready") return "not_blocked";
  if (!turnAwayReasons(input.readiness).includes(input.reason)) return "reason_not_blocking";
  return "eligible";
}
