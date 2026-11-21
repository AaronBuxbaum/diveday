import { MINUTE_MS } from "../../lib/clock";

/**
 * **How long a card a staffer deleted stays undoable** (issue #3701; Aaron,
 * 2026-11-03): the toast's lifetime, give or take. An Undo is an offer in a
 * URL, so anyone on the crew can type one; a short window is what keeps a
 * wrong card (a level typed too high, a nitrox card that was never real) from
 * being put back `verified` days later. Anything older is entered again and
 * sighted.
 */
export const CARD_UNDO_WINDOW_MS = 15 * MINUTE_MS;

/** Why a card's Undo does not put it back. Codes, never sentences. */
export type CardUndoRefusal =
  /**
   * DiveDay archived it in favor of other evidence, for a reason the staffer
   * holding the toast did not see; also a row that does not say how it was
   * archived, which fails closed.
   */
  | "system_archived"
  /** A staffer deleted it, longer ago than {@link CARD_UNDO_WINDOW_MS}. */
  | "undo_expired";

/**
 * Whether an archived card may come back by Undo: only a staffer's own
 * delete, and only inside the window. Null allows. The caller has already
 * proved the card is archived, this shop's and this diver's.
 */
export function cardUndoRefusal(
  card: { deletedAt: Date; deletionKind: "staff" | "system" | null },
  now: Date,
): CardUndoRefusal | null {
  if (card.deletionKind !== "staff") return "system_archived";
  if (now.getTime() - card.deletedAt.getTime() > CARD_UNDO_WINDOW_MS) return "undo_expired";
  return null;
}

/** The oldest `deleted_at` a card's Undo still restores, for the write's own guard. */
export function cardUndoCutoff(now: Date): Date {
  return new Date(now.getTime() - CARD_UNDO_WINDOW_MS);
}
