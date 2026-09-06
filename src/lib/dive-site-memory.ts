import { nowDate } from "./clock";

/**
 * **What a shop wants to remember about running a site** (issue #1204) — the
 * silted-up entry, the mooring ball somebody moved, the ranger who wants a
 * call first.
 *
 * The window is the whole of the domain rule and it is deliberately small:
 * after ninety days a planning note stops showing on the **site list**, which
 * is a planning surface people scan. Nothing is erased and nothing expires in
 * the database — the note stays on the row and stays on its own editor, where
 * somebody who came to think about this site can read it and decide whether it
 * still holds. An automatic deletion would be lifecycle machinery for
 * abandoned objects, which AGENTS.md refuses.
 *
 * Numbers and booleans only; the surface picks the words.
 */
export const PLANNING_NOTE_FRESH_DAYS = 90;

/** The longest a planning note may be — a note to a colleague, not a report. */
export const MAX_PLANNING_NOTE_LENGTH = 280;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days since the note was written, or null when nobody has written one. */
export function planningNoteDaysOld(notedAt: Date | null, now: Date = nowDate()): number | null {
  if (!notedAt) return null;
  return Math.floor((now.getTime() - notedAt.getTime()) / DAY_MS);
}

/**
 * Is this note still shown on the site list?
 *
 * Exactly ninety days old still counts; the ninety-first does not. A note with
 * no stamp is never fresh — there is nothing to be fresh.
 */
export function planningNoteIsFresh(notedAt: Date | null, now: Date = nowDate()): boolean {
  const days = planningNoteDaysOld(notedAt, now);
  return days !== null && days <= PLANNING_NOTE_FRESH_DAYS;
}
