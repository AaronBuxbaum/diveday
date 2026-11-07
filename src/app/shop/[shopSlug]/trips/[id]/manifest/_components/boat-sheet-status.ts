import { checkpointGapLine } from "@/components/checkpoint-gap-words";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { laterCheckpointMissing, previousCheckpointGaps } from "@/lib/checkpoint-gaps";
import {
  type RollCallCheckpoint,
  rollCallCheckpointOrdinal,
  type TripManifest,
} from "@/lib/manifests";

/**
 * **What the Boat tab's sheet says that its rows cannot** (issue #4067): the
 * screen's count panel and open-roll-call warning never print, so the sheet
 * states them itself, as lines above the roster. After a dive, how many are
 * back aboard; when the dive before is still open, the same line the screen
 * shows; and when a later count exists with someone not back aboard, that
 * count's name and who, so a sheet printed at after dive 1 never reads as
 * "everyone boarded" over a diver missing at after dive 2. At the dock: none.
 */
export function boatSheetStatus({
  manifests,
  manifest,
  checkpoint,
  t,
}: {
  /** The departure's manifests, dock first (`completeManifests`). */
  manifests: readonly (Pick<TripManifest, "checkpoint" | "summary" | "crew" | "divers"> & {
    crew: readonly { id: string; fullName: string }[];
  })[];
  manifest: Pick<TripManifest, "summary">;
  checkpoint: RollCallCheckpoint;
  t: StaffTranslator;
}): string[] {
  if (checkpoint === "departure") return [];
  const dive = rollCallCheckpointOrdinal(checkpoint);
  const lines = [
    t("manifest.sheetBackAboard", {
      aboard: manifest.summary.boarded,
      total: manifest.summary.totalDivers,
      dive,
    }),
  ];
  const open = previousCheckpointGaps(manifests).get(checkpoint);
  if (open) lines.push(checkpointGapLine(t, open));
  const later = laterCheckpointMissing(manifests, checkpoint);
  if (later) {
    const laterDive = rollCallCheckpointOrdinal(later.checkpoint);
    if (later.names.length > 0) {
      lines.push(
        t("manifest.sheetLaterCount", {
          dive: laterDive,
          missing: later.names.length,
          names: later.names.join(", "),
        }),
      );
    }
    if (later.unmarked > 0) {
      lines.push(t("manifest.sheetLaterUnmarked", { dive: laterDive, count: later.unmarked }));
    }
  }
  return lines;
}
