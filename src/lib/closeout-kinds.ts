/**
 * **The close-out's shapes, as codes** — what the evening's copy
 * (`src/i18n/closeout-labels.ts`, `src/i18n/load-out-labels.ts`) needs to name
 * without importing the close-out itself, which lives above the graph in
 * `src/features/today`.
 */
import type { PlanChangeReason } from "./plan-change";

/**
 * How one of today's departures stands at the end of the day, in descending
 * loudness. The gap statuses deliberately mirror the glossary's "unaccounted
 * for" split (kinds 1–4 versus 5–6): the ones that can mean a person is in
 * the water are never toned or worded like paperwork.
 *
 * - `unreconciled` — the departure carries an after-dive gap (missing diver or
 *   crew, or an unfinished after-dive count other than one still being
 *   taken). Loudest state on the page.
 * - `still_out` — the boat has left and is not due back yet. An after-dive
 *   count still being taken (`countStillBeingTaken`) reads here too, keeping
 *   its dive and count. Not an alarm, but a day cannot quietly read
 *   "everyone is home" while it isn't.
 * - `count_open` — a dock-count gap (`departure_uncounted` / `no_roll_call`).
 *   Paperwork, toned as such — see DOM-H3's wallpaper lesson in
 *   `src/features/today/today.ts`.
 * - `not_departed` — closing before a boat has even left. Stated, quietly.
 * - `all_home` — the head count closed clean. The state the ritual exists to
 *   confirm.
 */
export type CloseoutDepartureStatus =
  | "unreconciled"
  | "still_out"
  | "count_open"
  | "not_departed"
  | "all_home";

/**
 * **One dive whose actual site was not the planned one** (issue #1184, D24).
 *
 * Read off `executed_dives`, never inferred: the manifest's own dive log is
 * where a crew records both the site they dived and, optionally, why. A dive
 * that changed with nothing said about why still carries the true half.
 */
export type CloseoutPlanChange = {
  diveNumber: number;
  /** The site the boat actually dived, as the shop named it. */
  siteName: string;
  reasonCode: PlanChangeReason | null;
};

/** People (bookings) and crew still to mark at a count being taken. */
export type OpenCount = { people: number; crew: number };

/** Tomorrow's boats in one line: departures, tanks by gas, and rental pieces to pull. */
export type DayLoadOut = {
  departures: number;
  tanks: { total: number; air: number; nitrox: number };
  rentalPieces: number;
};
