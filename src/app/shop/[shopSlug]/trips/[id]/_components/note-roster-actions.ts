import {
  addInternalNoteAction,
  deleteInternalNoteAction,
  restoreInternalNoteAction,
} from "../notes-actions";

/**
 * The departure's internal notes on the Divers tab, bound to this departure:
 * write one, delete it softly, and put it back from the undo line.
 */
export function noteRosterActions(shopSlug: string, tripId: string) {
  return {
    addInternalNoteAction: addInternalNoteAction.bind(null, shopSlug, tripId),
    deleteInternalNoteAction: deleteInternalNoteAction.bind(null, shopSlug, tripId),
    restoreInternalNoteAction: restoreInternalNoteAction.bind(null, shopSlug, tripId),
  };
}
