import type { DiveParticipation } from "@/lib/dive-participation";
import type { RollCallCheckpoint, TripManifest } from "@/lib/manifests";
import { rollCallCheckpointOrdinal } from "@/lib/roll-call";
import type { bindManifestActions } from "./bound-actions";
import type { CrewRollCall } from "./CrewRollCall";
import type { DiverRollCallContext } from "./diver-roll-call-context";
import { departureCaptain } from "./emergency-text";
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
  /** The shop's name, for the drafted emergency text (issue #4256). */
  shopName: string;
  /** The newest participation note per seat and dive (issue #4307). */
  diveParticipation: ReadonlyMap<string, ReadonlyMap<number, DiveParticipation>>;
  t: DiverRollCallContext["t"];
}): { divers: DiverRollCallContext; crew: CrewRollCallProps } {
  const { idPrefix, shopSlug, tripId, locale, timezone, buddyTeamLabel, t } = shared;
  // The paper sets `paper` on top of these and never draws the link.
  const emergencyText = {
    shopName: shared.shopName,
    tripTitle: manifest.trip.title,
    startsAt: manifest.trip.startsAt,
    captainName: departureCaptain(manifest.crew),
    locale,
    timezone,
  };
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
      // After a dive only: the note is about that dive, and the dock has none.
      diveParticipation: isDeparture
        ? undefined
        : {
            diveNumber: rollCallCheckpointOrdinal(checkpoint),
            bySeat: (bookingId: string) =>
              shared.diveParticipation.get(bookingId)?.get(rollCallCheckpointOrdinal(checkpoint)) ??
              "unknown",
            action: actions.recordDiveParticipation,
          },
      missingDiver: actions.missingDiver,
      rollCallButtonCopy: copies.rollCallButtonCopy,
      buddyTeamLabel,
      // The medical-alert reads, and the words a "Print with medical alerts"
      // packet carries (`TripPacket`).
      ...actions.medicalAlert,
      emergencyText,
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
      emergencyText,
      t,
    },
  };
}
