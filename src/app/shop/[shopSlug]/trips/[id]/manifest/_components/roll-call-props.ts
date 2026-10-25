import type { RollCallCheckpoint, TripManifest } from "@/lib/manifests";
import type { bindManifestActions } from "./bound-actions";
import type { CrewRollCall } from "./CrewRollCall";
import type { DiverRollCallContext } from "./diver-roll-call-context";
import type { rollCallCopies } from "./roll-call-copy";

type ManifestActions = ReturnType<typeof bindManifestActions>;
type CrewRollCallProps = Parameters<typeof CrewRollCall>[0];

/**
 * **One set of props per roll-call list**, read by the live manifest and by
 * the packet's paper alike (B03). Built once so the two can never disagree
 * about who is listed, what was recorded, or whether the roll call is closed:
 * the paper adds `paper` and nothing else.
 */
export function manifestRollCallProps({
  manifest,
  checkpoint,
  isDeparture,
  rollCallClosed,
  actions,
  copies,
  ...shared
}: {
  idPrefix: string | undefined;
  manifest: Pick<TripManifest, "divers" | "crew" | "trip">;
  checkpoint: RollCallCheckpoint;
  isDeparture: boolean;
  shopSlug: string;
  tripId: string;
  locale: string;
  timezone: string;
  notesByBooking: DiverRollCallContext["notesByBooking"];
  todayTrailBySubject: DiverRollCallContext["todayTrailByBooking"];
  rollCallClosed: boolean;
  actions: ManifestActions;
  copies: ReturnType<typeof rollCallCopies>;
  buddyTeamLabel: DiverRollCallContext["buddyTeamLabel"];
  t: DiverRollCallContext["t"];
}): { divers: DiverRollCallContext; crew: CrewRollCallProps } {
  const { idPrefix, shopSlug, tripId, locale, timezone, buddyTeamLabel, t } = shared;
  return {
    divers: {
      idPrefix,
      divers: manifest.divers,
      crew: manifest.crew,
      checkpoint,
      isDeparture,
      exceedsNoDecoLimits: manifest.trip.exceedsNoDecoLimits,
      shopSlug,
      tripId,
      locale,
      timezone,
      notesByBooking: shared.notesByBooking,
      todayTrailByBooking: shared.todayTrailBySubject,
      rollCallAction: actions.rollCall,
      rollCallClosed,
      addPrivateNoteAction: actions.addPrivateNote,
      missingDiver: actions.missingDiver,
      rollCallButtonCopy: copies.rollCallButtonCopy,
      buddyTeamLabel,
      // The medical-alert reads, and the words a "Print with medical alerts"
      // packet carries (`PRINTED_MEDICAL_ALERTS`).
      ...actions.medicalAlert,
      t,
    },
    crew: {
      crew: manifest.crew,
      idPrefix,
      divers: manifest.divers,
      checkpoint,
      isDeparture,
      shopSlug,
      tripId,
      locale,
      timezone,
      todayTrailBySubject: shared.todayTrailBySubject,
      crewRollCallAction: actions.crewRollCall,
      rollCallClosed,
      crewRollCallButtonCopy: copies.crewRollCallButtonCopy,
      missingDiver: actions.missingDiver,
      buddyTeamLabel,
      t,
    },
  };
}
