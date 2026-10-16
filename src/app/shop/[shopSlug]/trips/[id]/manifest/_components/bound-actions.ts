import {
  addBuddyTeamMemberAction,
  addManifestPrivateNoteAction,
  answerSnagAction,
  crewRollCallAction,
  dissolveBuddyTeamAction,
  formBuddyTeamAction,
  type ManifestActionContext,
  markTripCaughtUpAction,
  noteSnagAction,
  preDepartureCheckAction,
  removeBuddyTeamMemberAction,
  rollCallAction,
  saveExecutedDiveAction,
  setTripStageAction,
  teamUpPartiesAction,
} from "../actions";

/**
 * **Every mutation on this page, bound once to the departure and checkpoint it
 * is about.** The actions live in `../actions.ts` at module scope. That
 * context used to be captured from the render by inline `"use server"`
 * closures — the same sealed channel, said out loud — and each action
 * re-proves what it is handed rather than believing it (see that file's own
 * note).
 *
 * One named context object — `shopSlug` and `tripId` are both opaque ids of
 * the same shape, and as positional arguments swapping them was a silent,
 * well-typed mistake that revalidated another shop's route.
 */
export function bindManifestActions(actionContext: ManifestActionContext) {
  const { shopSlug, tripId } = actionContext;
  return {
    rollCall: rollCallAction.bind(null, actionContext),
    crewRollCall: crewRollCallAction.bind(null, actionContext),
    // The note carries its own checkpoint and the action re-proves it, so this
    // one takes the narrower context that has none.
    addPrivateNote: addManifestPrivateNoteAction.bind(null, { shopSlug, tripId }),
    saveExecutedDive: saveExecutedDiveAction.bind(null, actionContext),
    // *Got it* is checkpoint-independent — the strip is about the departure,
    // not about which list is open — so it takes the narrower context.
    markTripCaughtUp: markTripCaughtUpAction.bind(null, { shopSlug, tripId }),
    // Same narrower context as the note above: the checklist is checkpoint-
    // independent, so its action re-proves nothing about which one was open.
    preDepartureCheck: preDepartureCheckAction.bind(null, { shopSlug, tripId }),
    // A snag is about the boat, not the checkpoint: the same narrower context.
    noteSnag: noteSnagAction.bind(null, { shopSlug, tripId }),
    answerSnag: answerSnagAction.bind(null, { shopSlug, tripId }),
    setTripStage: setTripStageAction.bind(null, { shopSlug, tripId }),
    // Named as `BuddyTeamsPanel` takes them, so the page hands them on whole.
    buddyTeams: {
      formBuddyTeamAction: formBuddyTeamAction.bind(null, actionContext),
      teamUpPartiesAction: teamUpPartiesAction.bind(null, actionContext),
      addBuddyTeamMemberAction: addBuddyTeamMemberAction.bind(null, actionContext),
      removeBuddyTeamMemberAction: removeBuddyTeamMemberAction.bind(null, actionContext),
      dissolveBuddyTeamAction: dissolveBuddyTeamAction.bind(null, actionContext),
    },
  };
}
