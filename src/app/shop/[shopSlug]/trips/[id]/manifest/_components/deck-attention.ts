import { isNotBackAboard, type RollCallCheckpoint, type TripManifest } from "@/lib/manifests";
import type { headCountView } from "./head-count-view";

/** Whether shared safety facts need the Deck's attention summary. */
export function deckAttentionNeeded(input: {
  manifest: TripManifest;
  checkpoint: RollCallCheckpoint;
  alerted: ReadonlySet<string>;
  headCount: ReturnType<typeof headCountView>;
}): boolean {
  const { manifest, checkpoint, alerted, headCount } = input;
  return (
    (manifest.summary.recountRequired ?? 0) > 0 ||
    (manifest.summary.historicalReviewRequired ?? 0) > 0 ||
    manifest.divers.some(
      (row) => isNotBackAboard(checkpoint, row.rollCall) || row.rollCallContext?.conflict,
    ) ||
    manifest.crew.some(
      (row) => isNotBackAboard(checkpoint, row.rollCall) || row.rollCallContext?.conflict,
    ) ||
    alerted.size > 0 ||
    manifest.crew.length === 0 ||
    manifest.completeness.crewReason === "crew_none_aboard" ||
    manifest.summary.overCapacity > 0 ||
    (checkpoint === "departure" && headCount.blockedAtDock.aboard > 0) ||
    headCount.overCertificate !== null ||
    headCount.overTotalPersons !== null
  );
}
