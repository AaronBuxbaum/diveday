import { withholdHeldSeatParticulars } from "@/lib/held-seat";
import {
  isRollCallCheckpoint,
  manifestAtCheckpoint,
  type RollCallCheckpoint,
  type TripManifest,
} from "@/lib/manifests";

/**
 * **The checkpoint this page opens on, and its manifest**: the one the URL
 * asked for, or the dock when it asked for none.
 *
 * Two other answers, and neither is the dock (#2508):
 *
 * - `{ stale: true }` for a `?checkpoint=` this departure's plan does not
 *   have. The page redirects to its canonical address rather than render the
 *   dock under it, where a bookmarked `after_dive_3` would silently flip to
 *   the after-dive view once the plan grew to three dives.
 * - **A throw** for a checkpoint the plan has but no manifest was built for.
 *   Every manifest comes from `rollCallCheckpoints(plannedDives)`, so that is
 *   an assembly bug, and answering it as the dock is failing open.
 */
export function openCheckpoint(
  completeManifests: readonly TripManifest[],
  departureManifest: TripManifest,
  requestedCheckpoint: string | undefined,
) {
  const plannedDiveCount = departureManifest.trip.plannedDives;
  const requested = requestedCheckpoint ?? "departure";
  if (!isRollCallCheckpoint(requested, plannedDiveCount)) return { stale: true } as const;
  const checkpointManifest = manifestAtCheckpoint(completeManifests, requested);
  if (!checkpointManifest) {
    throw new Error(`manifest: no manifest was built for checkpoint ${requested}`);
  }
  const checkpoint: RollCallCheckpoint = checkpointManifest.checkpoint;
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
  return { checkpoint, isDeparture, manifest };
}
