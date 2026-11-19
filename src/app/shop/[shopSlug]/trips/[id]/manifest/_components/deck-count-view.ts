import { compareDeckCount, type DeckCountComparison } from "@/features/deck-counts";
import { physicalPeople } from "@/lib/manifest-person-counts";
import { type RollCallCheckpoint, rollCallRowState, type TripManifest } from "@/lib/manifests";

/**
 * **The count on deck beside the screen's** (issue #4248): the newest count
 * entered at this checkpoint against everyone the roll call marked aboard
 * there, divers and crew, each physical person once (`physicalPeople`). Null
 * comparison when nobody entered a count, which says nothing.
 */
export function deckCountView(
  manifest: Pick<TripManifest, "divers" | "crew">,
  checkpoint: RollCallCheckpoint,
  deckCounts: ReadonlyMap<RollCallCheckpoint, number>,
): { counted: number | null; aboard: number; comparison: DeckCountComparison | null } {
  const aboard = physicalPeople(
    manifest.divers.filter((diver) => rollCallRowState(checkpoint, diver.rollCall).boarded),
    manifest.crew.filter((member) => rollCallRowState(checkpoint, member.rollCall).boarded),
  );
  const counted = deckCounts.get(checkpoint) ?? null;
  return {
    counted,
    aboard,
    comparison: manifest.divers.some((diver) => diver.recountRequired)
      ? null
      : compareDeckCount(counted, aboard),
  };
}
