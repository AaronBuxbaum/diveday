import {
  isNotBackAboard,
  type RollCallCheckpoint,
  rollCallCheckpointOrdinal,
  type TripManifest,
} from "./manifests";
import { inAfterDivePopulation, type RollCallState } from "./roll-call-population";

/**
 * **Who a checkpoint still owes a statement about** — batch 6, items 3 and 4.
 *
 * Two warnings read this, and both only warn: opening the next after-dive
 * roll call while the one before it is still open, and the crew saying the
 * boat is heading in (or home) while the last one is. Neither refuses
 * anything; the crew can always open a checkpoint and always say where the
 * boat is.
 *
 * The divers are the ones the checkpoint's own completeness verdict closes on
 * (`rollCallCompleteness`, src/lib/manifests.ts): no result, plus recorded
 * not back aboard. **The crew follow Today's population rule**
 * (`inAfterDivePopulation`, src/lib/roll-call-population.ts): a crew member
 * recorded not back aboard always counts, but one with no result here counts
 * only when they were boarded at the dock or have a result at some after-dive
 * checkpoint. A shop that has never adopted crew roll call would otherwise be
 * warned on every tap about crew nobody ever counts (dive-domain review
 * 20261014). The panel itself still holds the checkpoint open for them.
 *
 * The two halves stay apart, so the words can say "11 passengers and 3
 * crew" rather than a sum that hides which list to look at. People recorded
 * not back aboard are counted apart from both: they have been marked, and
 * they are the missing-diver row, which is a different next step from a tap
 * nobody has made yet (dive-domain review, 2026-10-16).
 */
export type CheckpointGap =
  | {
      kind: "unmarked";
      checkpoint: RollCallCheckpoint;
      /**
       * Passengers (divers, snorkelers and riders alike) with no result here.
       * The name is older than the count.
       */
      divers: number;
      /** Crew in the after-dive count with no result here. */
      crew: number;
      /** Passengers and crew recorded not back aboard here. */
      missing: number;
    }
  | {
      /**
       * The last planned dive has no result for anybody while the dive before
       * it is closed: most often a dive called off with the plan left at the
       * old count. Still a warning; the words offer the plan as the other way
       * out (`homewardCheckpointGap`).
       */
      kind: "not_counted";
      checkpoint: RollCallCheckpoint;
    };

/**
 * A crew member as a checkpoint reads them. `rollCall` is only the state and
 * whether it was carried forward, so the offline manifest's own reading
 * (`OfflineRollCallResult`) fits as well as the live record.
 */
type GapCrewMember = {
  id: string;
  rollCall?: { state: "boarded" | "not_boarded"; implied?: boolean } | undefined;
};
type GapManifest = Pick<TripManifest, "checkpoint"> & {
  summary: Pick<TripManifest["summary"], "awaiting" | "boarded" | "notBackAboard">;
  crew: readonly GapCrewMember[];
};

/** A result somebody recorded here; a carried-forward default is not one. */
function recordedState(rollCall: GapCrewMember["rollCall"]): RollCallState {
  if (!rollCall || rollCall.implied) return undefined;
  return rollCall.state;
}

/**
 * The crew members `inAfterDivePopulation` counts, by id, read across the
 * departure's whole list (the dock's result, and any after-dive one).
 */
function crewInAfterDiveCount(manifests: readonly GapManifest[]): Set<string> {
  const dock = manifests.find((manifest) => manifest.checkpoint === "departure");
  const afterDives = manifests.filter((manifest) => manifest.checkpoint !== "departure");
  const ids = new Set(manifests.flatMap((manifest) => manifest.crew.map((member) => member.id)));
  const counted = new Set<string>();
  for (const id of ids) {
    const stateAt = (manifest: GapManifest | undefined) =>
      recordedState(manifest?.crew.find((member) => member.id === id)?.rollCall);
    if (inAfterDivePopulation([stateAt(dock), ...afterDives.map(stateAt)])) counted.add(id);
  }
  return counted;
}

function unmarkedAt(manifest: GapManifest, counted: ReadonlySet<string>): CheckpointGap | null {
  const divers = manifest.summary.awaiting;
  const crew = manifest.crew.filter((member) => !member.rollCall && counted.has(member.id)).length;
  const crewMissing = manifest.crew.filter(
    (member) => member.rollCall && isNotBackAboard(manifest.checkpoint, member.rollCall),
  ).length;
  const missing = manifest.summary.notBackAboard + crewMissing;
  return divers + crew + missing > 0
    ? { kind: "unmarked", checkpoint: manifest.checkpoint, divers, crew, missing }
    : null;
}

/**
 * The people one checkpoint of this departure has not accounted for, or null
 * when it has everyone. `manifests` is the departure's ordered list
 * (`rollCallCheckpoints`), dock first; the crew rule reads all of it.
 */
export function checkpointGap(
  manifests: readonly GapManifest[],
  checkpoint: RollCallCheckpoint,
): CheckpointGap | null {
  const manifest = manifests.find((each) => each.checkpoint === checkpoint);
  return manifest ? unmarkedAt(manifest, crewInAfterDiveCount(manifests)) : null;
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
  const counted = crewInAfterDiveCount(manifests);
  manifests.forEach((manifest, index) => {
    const before = index > 0 ? manifests[index - 1] : undefined;
    const gap = before && before.checkpoint !== "departure" ? unmarkedAt(before, counted) : null;
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
 *
 * **A last dive nobody counted, after a closed one, is worded as a plan
 * question** (dive-domain review 20261014): with no result for anybody there
 * and the dive before it closed, the likeliest story is a dive called off and
 * the plan left at the old count, and "8 people not marked" would send the
 * crew counting a boat that never went in. It stays a warning (`not_counted`)
 * so a skipped count is never silent; the words offer both ways out.
 */
export function homewardCheckpointGap(manifests: readonly GapManifest[]): CheckpointGap | null {
  const last = manifests.at(-1);
  if (!last || last.checkpoint === "departure") return null;
  const counted = crewInAfterDiveCount(manifests);
  const gap = unmarkedAt(last, counted);
  if (!gap) return null;
  const before = manifests.at(-2);
  const nobodyCounted =
    last.summary.boarded + last.summary.notBackAboard === 0 &&
    last.crew.every((member) => recordedState(member.rollCall) === undefined);
  const beforeClosed =
    before !== undefined && before.checkpoint !== "departure" && !unmarkedAt(before, counted);
  return nobodyCounted && beforeClosed ? { kind: "not_counted", checkpoint: last.checkpoint } : gap;
}

/** The dive count a `not_counted` gap suggests: the dives before the uncounted one. */
export function plannedDivesWithout(gap: CheckpointGap): number {
  return rollCallCheckpointOrdinal(gap.checkpoint) - 1;
}

/** The stages that say the diving is over (`TRIP_STAGES`, src/lib/trip-stages.ts). */
export const HOMEWARD_STAGES = ["heading_in", "home"] as const;

export function isHomewardStage(stage: string): stage is (typeof HOMEWARD_STAGES)[number] {
  return (HOMEWARD_STAGES as readonly string[]).includes(stage);
}
