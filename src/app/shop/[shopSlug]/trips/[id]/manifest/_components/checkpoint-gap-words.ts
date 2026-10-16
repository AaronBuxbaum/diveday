import type { StaffTranslator } from "@/i18n/staff-messages";
import { type CheckpointGap, plannedDivesWithout } from "@/lib/checkpoint-gaps";
import { rollCallCheckpointOrdinal } from "@/lib/manifests";

/**
 * The one line both roll-call warnings say (batch 6, items 3 and 4): the
 * checkpoint switch's guard and the opened page, and the stage strip on the
 * way home. Passengers and crew are worded apart — "11 passengers and 3
 * crew" — so the crew know which list to look at (dive-domain review
 * 20261014). The count is everyone booked aboard, snorkelers and riders with
 * the divers, so the words say people, never divers (2026-10-16 sheet item 4).
 */
export function checkpointGapLine(t: StaffTranslator, gap: CheckpointGap): string {
  const dive = rollCallCheckpointOrdinal(gap.checkpoint);
  if (gap.kind === "not_counted") {
    return t("manifest.checkpointGap.notCounted", { dive, plan: plannedDivesWithout(gap) });
  }
  if (gap.crew === 0) return t("manifest.checkpointGap.lineDivers", { divers: gap.divers, dive });
  if (gap.divers === 0) return t("manifest.checkpointGap.lineCrew", { crew: gap.crew, dive });
  return t("manifest.checkpointGap.lineBoth", { divers: gap.divers, crew: gap.crew, dive });
}
