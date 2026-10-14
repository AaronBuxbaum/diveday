import type { RollCallCheckpoint, TripManifest } from "./manifests";

/**
 * **Who a checkpoint still owes a statement about** — batch 6, items 3 and 4.
 *
 * Two warnings read this, and both only warn: opening the next after-dive
 * roll call while the one before it is still open, and the crew saying the
 * boat is heading in (or home) while the last one is. Neither refuses
 * anything; the crew can always open a checkpoint and always say where the
 * boat is.
 *
 * The count is the one the checkpoint's own completeness verdict closes on
 * (`rollCallCompleteness`, src/lib/manifests.ts): divers with no result plus
 * divers recorded not back aboard, and the same two halves of the crew. So
 * the warning can never disagree with the panel the crew is about to open —
 * a checkpoint that reads complete raises nothing here.
 */
export type CheckpointGap = {
  checkpoint: RollCallCheckpoint;
  /** Divers and crew not accounted for there. Always at least 1. */
  unaccounted: number;
};

type GapManifest = Pick<TripManifest, "checkpoint" | "summary" | "completeness">;

/** The people one checkpoint has not accounted for, or null when it has everyone. */
export function checkpointGap(manifest: GapManifest): CheckpointGap | null {
  const crew = manifest.completeness.crewCounts;
  const unaccounted =
    manifest.summary.awaiting +
    manifest.summary.notBackAboard +
    crew.crewAwaiting +
    crew.crewNotBackAboard;
  return unaccounted > 0 ? { checkpoint: manifest.checkpoint, unaccounted } : null;
}

/**
 * For each after-dive checkpoint after the first, the gap at the after-dive
 * checkpoint before it — what opening it should warn about. Keyed by the
 * checkpoint being opened; one with a closed predecessor has no entry.
 * `manifests` is the departure's ordered list (`rollCallCheckpoints`), dock
 * first.
 *
 * The dock is never the "before": an untaken dock count is already its own
 * row (**No roll call taken**), and the first after-dive count is the physical
 * head count that settles who is aboard whatever the dock said, so warning on
 * the way to it would stand between the crew and the count that fixes it.
 */
export function previousCheckpointGaps(
  manifests: readonly GapManifest[],
): Map<RollCallCheckpoint, CheckpointGap> {
  const gaps = new Map<RollCallCheckpoint, CheckpointGap>();
  manifests.forEach((manifest, index) => {
    const before = index > 0 ? manifests[index - 1] : undefined;
    const gap = before && before.checkpoint !== "departure" ? checkpointGap(before) : null;
    if (gap) gaps.set(manifest.checkpoint, gap);
  });
  return gaps;
}

/**
 * **The count that has to be closed before the boat heads in**: the last
 * after-dive checkpoint's gap, or null when it has everyone (or the list has
 * no after-dive checkpoint at all). The last one, not every one: it is the
 * head count of who is aboard now, and a diver missing after dive 1 who is
 * counted aboard after dive 2 is back. A diver still missing is unaccounted
 * at the last checkpoint too, so nothing earlier is lost by asking only it.
 */
export function homewardCheckpointGap(manifests: readonly GapManifest[]): CheckpointGap | null {
  const last = manifests.at(-1);
  if (!last || last.checkpoint === "departure") return null;
  return checkpointGap(last);
}

/** The stages that say the diving is over (`TRIP_STAGES`, src/lib/trip-stages.ts). */
export const HOMEWARD_STAGES = ["heading_in", "home"] as const;

export function isHomewardStage(stage: string): stage is (typeof HOMEWARD_STAGES)[number] {
  return (HOMEWARD_STAGES as readonly string[]).includes(stage);
}
