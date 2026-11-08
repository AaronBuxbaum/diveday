/**
 * **Why a head count is open, as codes** — the roll-call gap reasons and the
 * Today row each becomes. Below Today so the stale-count alert, the close-out
 * and the copy can name a reason without importing the queue.
 */
import type { TodayActionKind } from "./today-kinds";

/**
 * Why one trip's head count is not closed (DOM-H3). Codes, not sentences: the
 * evidence is gathered in `src/features/roll-call-gaps/store.ts` and the words come from
 * `src/i18n/today-labels.ts`. They are deliberately *not* interchangeable —
 * collapsing them into one row is the defect this type exists to prevent:
 *
 * - `missing_diver` — somebody tapped "not back aboard" at an after-dive
 *   checkpoint. A human said a diver did not return to the boat. Loudest row
 *   the app has.
 * - `missing_crew` — the same statement about a named **crew member** (ADR
 *   20260803-per-person-crew-roll-call). The DM who went back down for a lost
 *   weight belt and has not surfaced is exactly this row, and until it existed
 *   the manifest went red while Today and the schedule board said nothing —
 *   which made the glossary's "an unclosed head count is chased, not merely
 *   displayed" false for the people most reliably in the water (review
 *   20260803, D1).
 * - `after_dive_uncounted` — an after-dive checkpoint where a diver who
 *   *boarded at departure* still has no result. Nobody said they are missing;
 *   nobody said they are aboard either.
 * - `crew_uncounted` — the same, for a crew member who boarded at departure.
 * - `departure_uncounted` — the dock count never finished. The boat is home and
 *   nobody was ever unaccounted for in the water: this is paperwork.
 * - `no_roll_call` — the trip has no roll-call events at all. That is a shop
 *   not using the feature, not a lost diver — but reading it as fine would be a
 *   false all-clear, so it is still stated, quietly.
 *
 * The two crew kinds count the same **population rule** the diver kinds do: only
 * somebody who actually boarded is in the water. A shop that never taps a crew
 * roll call therefore raises no crew rows at all, rather than a danger-toned
 * row on every trip it ever ran — which is the failure mode that stops the red
 * rows being read.
 */
export type RollCallGapReason =
  | "missing_diver"
  | "missing_crew"
  | "after_dive_uncounted"
  | "crew_uncounted"
  | "departure_uncounted"
  | "no_roll_call";

/** Which queue row each gap becomes. One place, so tone and severity can't drift. */
export const ROLL_CALL_GAP_KINDS: Record<RollCallGapReason, TodayActionKind> = {
  missing_diver: "roll_call_missing_diver",
  missing_crew: "roll_call_missing_crew",
  after_dive_uncounted: "roll_call_unfinished",
  crew_uncounted: "roll_call_crew_unfinished",
  departure_uncounted: "roll_call_departure_open",
  no_roll_call: "roll_call_not_started",
};

/**
 * The gap reasons that mean a person may still be in the water (glossary
 * kinds 1–4), as opposed to the dock-count reasons, which are paperwork. The
 * split decides which departures read as `unreconciled` — the loudest state a
 * station can settle into — and which read as `count_open`.
 */
export const AFTER_DIVE_GAP_REASONS: ReadonlySet<RollCallGapReason> = new Set([
  "missing_diver",
  "missing_crew",
  "after_dive_uncounted",
  "crew_uncounted",
]);
