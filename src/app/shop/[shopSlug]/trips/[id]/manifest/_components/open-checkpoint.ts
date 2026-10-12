import { notFound } from "next/navigation";
import { withholdHeldSeatParticulars } from "@/lib/held-seat";
import {
  isRollCallCheckpoint,
  type RollCallCheckpoint,
  rollCallCheckpoints,
  type TripManifest,
} from "@/lib/manifests";

/**
 * **The checkpoint this page opens on, and its manifest**: the one the URL
 * asked for when the departure has it, the dock otherwise. A checkpoint with
 * no manifest is a 404, like a departure with none.
 */
export function openCheckpoint(
  completeManifests: readonly TripManifest[],
  departureManifest: TripManifest,
  requestedCheckpoint: string | undefined,
) {
  const plannedDiveCount = departureManifest.trip.plannedDives;
  const checkpoints = rollCallCheckpoints(plannedDiveCount);
  const checkpoint: RollCallCheckpoint =
    requestedCheckpoint && isRollCallCheckpoint(requestedCheckpoint, plannedDiveCount)
      ? requestedCheckpoint
      : "departure";
  const checkpointManifest = completeManifests.find((entry) => entry.checkpoint === checkpoint);
  if (!checkpointManifest) notFound();
  // Held seats are settled once, here, so every reader on the page — the
  // not-back-aboard alarm, the buddy builder, both roll calls — sees the seat
  // and never the matched person's particulars (issue #1690).
  const manifest = {
    ...checkpointManifest,
    divers: checkpointManifest.divers.map(withholdHeldSeatParticulars),
  };
  // Readiness gates boarding at departure only. After a dive, roll call is a
  // physical head count — a diver who is aboard is recorded present regardless
  // of a paperwork state that changed after the boat left.
  const isDeparture = checkpoint === "departure";
  return { checkpoints, checkpoint, isDeparture, manifest };
}
