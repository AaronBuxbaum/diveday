import {
  markMissingSubjectFoundAction,
  raiseMissingDiverAlertAction,
  startMissingDiverReportAction,
} from "../../incidents/actions";
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
import {
  emergencyShowSeatMedicalAlertAction,
  showSeatMedicalAlertAction,
} from "../medical-alert-action";
import { type ManifestSearchParams, PRINTED_MEDICAL_ALERTS } from "./manifest-search-params";

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
export function bindManifestActions(
  actionContext: ManifestActionContext,
  /** Whether the reader may start an incident report here (`mayStartTripIncidentReport`). */
  reader: {
    mayStartIncidentReport: boolean;
    /** Seats and crew whose owners were alerted and who are not found yet (issue #2694). */
    alerted?: ReadonlySet<string>;
    /** Whether the reader may read the medical alerts on this departure (issue #2960). */
    mayReadMedicalAlerts?: boolean;
    /** Whether the reader may open them in an emergency instead, today (issue #2990). */
    mayEmergencyReadMedicalAlerts?: boolean;
  } = { mayStartIncidentReport: false },
  /** The page's own search params: the printed words ride on them, never on the URL. */
  query: ManifestSearchParams = {},
) {
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
    // A row's two missing-diver controls, the row binding its own seat; none
    // for a reader who may not start a report. Each write re-checks.
    missingDiver: {
      // "Start a missing diver report".
      startMissingDiverReport: reader.mayStartIncidentReport
        ? startMissingDiverReportAction.bind(null, shopSlug, tripId)
        : null,
      // "Missing diver, alert owners now" (issue #2694).
      raiseMissingDiverAlert: reader.mayStartIncidentReport
        ? raiseMissingDiverAlertAction.bind(null, shopSlug, tripId)
        : null,
      // "Found", on a row whose owners were alerted and which is marked back
      // aboard (review 2026-10-17); the write refuses while it is not.
      markMissingSubjectFound: reader.mayStartIncidentReport
        ? markMissingSubjectFoundAction.bind(null, shopSlug, tripId)
        : null,
      missingAlerted: reader.alerted ?? new Set<string>(),
    },
    // What a diver row's medical alert block is handed (`DiverRollCallContext`).
    medicalAlert: {
      // One seat's "Show the alert", only for a reader allowed the words here;
      // the action re-checks and records the read before it answers.
      showMedicalAlert: reader.mayReadMedicalAlerts
        ? (bookingId: string) => showSeatMedicalAlertAction.bind(null, shopSlug, tripId, bookingId)
        : undefined,
      // One seat's "Emergency: show the alert", only for a reader the crew rule
      // refuses on the day; the action re-checks and records every confirm.
      emergencyShowMedicalAlert:
        !reader.mayReadMedicalAlerts && reader.mayEmergencyReadMedicalAlerts
          ? (bookingId: string) =>
              emergencyShowSeatMedicalAlertAction.bind(null, shopSlug, tripId, bookingId)
          : undefined,
      // The words, only when "Print with medical alerts" composed this page,
      // under a key no URL can carry (`PRINTED_MEDICAL_ALERTS`, issue #2990).
      printedMedicalAlerts: query[PRINTED_MEDICAL_ALERTS],
    },
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
