import { type CheckpointGap, previousCheckpointGaps } from "@/lib/checkpoint-gaps";
import { isNotBackAboard, type RollCallCheckpoint } from "@/lib/manifests";
import {
  latestOfflineCrewRollCall,
  latestOfflineRollCall,
  type OfflineManifestEnvelope,
} from "@/lib/offline-manifests";

/**
 * **The saved copy, read the way `checkpointGap` wants it**
 * (`src/lib/checkpoint-gaps.ts`): per checkpoint, how many divers have no
 * result or are recorded not back aboard, and each crew member's result. Both
 * halves read this device's own taps ahead of the saved copy
 * (`latestOfflineRollCall`, `latestOfflineCrewRollCall`), so a count taken
 * with no signal is a count here the moment it is tapped.
 *
 * A crew member whose copy predates ids has no subject to write an event
 * against; the saved result stands, and the index keys them apart. Absence is
 * "nobody has said" on both routes, never "accounted for" (the same rule
 * `offlineTripView` follows), so a gap is never hidden by a missing id.
 */
export function offlineCheckpointGapInputs(envelope: OfflineManifestEnvelope) {
  const { snapshot, events } = envelope;
  return snapshot.manifests.map((manifest) => {
    const states = manifest.divers.map((diver) =>
      latestOfflineRollCall(snapshot, events, diver.bookingId, manifest.checkpoint),
    );
    return {
      checkpoint: manifest.checkpoint,
      summary: {
        boarded: states.filter((state) => state?.state === "boarded").length,
        awaiting: states.filter((state) => !state).length,
        notBackAboard: states.filter((state) => isNotBackAboard(manifest.checkpoint, state)).length,
      },
      crew: manifest.crew.map((member, index) => ({
        id: member.id ?? `crew-${index}`,
        rollCall: member.id
          ? latestOfflineCrewRollCall(snapshot, events, member.id, manifest.checkpoint)
          : member.rollCall,
      })),
    };
  });
}

/** The gap at the checkpoint before each after-dive one, keyed by the one being opened. */
export function offlinePreviousGaps(
  envelope: OfflineManifestEnvelope,
): Map<RollCallCheckpoint, CheckpointGap> {
  return previousCheckpointGaps(offlineCheckpointGapInputs(envelope));
}
