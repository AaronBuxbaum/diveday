import {
  restoreDiverCard,
  restoreDiverNote,
  restoreDiverRemoval,
} from "@/app/shop/[shopSlug]/divers/[personId]/undo-inverses";
import {
  restoreConservationRecord,
  restoreTeachingNote,
} from "@/app/shop/[shopSlug]/trips/[id]/undo-inverses";
import type { UndoKind, UndoOffer, UndoOfferOf } from "@/lib/undo";

/**
 * **Every Undo's inverse, by kind** (issue #2764) — the registry the one
 * generic `undoAction` dispatches through, shaped like `HELD_SEND_KINDS`. A
 * kind added to `UNDO_KINDS` without a row here is a compile error, and a row
 * is the only way a removal gets a way back: there is no inverse server action
 * to export beside it.
 *
 * Not a `"use server"` module, so no row is an endpoint of its own. Each row
 * re-runs the live gate of the removal it reverses and never returns: it lands
 * the staffer, refusal or success.
 */
const UNDO_INVERSES: {
  readonly [K in UndoKind]: (shopSlug: string, offer: UndoOfferOf<K>) => Promise<never>;
} = {
  "diver-card": restoreDiverCard,
  "diver-note": restoreDiverNote,
  "diver-removal": restoreDiverRemoval,
  "trip-conservation": restoreConservationRecord,
  "course-teaching-note": restoreTeachingNote,
};

/** Runs the offer's inverse. */
export function takeBack(shopSlug: string, offer: UndoOffer): Promise<never> {
  const inverse = UNDO_INVERSES[offer.undo] as (
    shopSlug: string,
    offer: UndoOffer,
  ) => Promise<never>;
  return inverse(shopSlug, offer);
}
