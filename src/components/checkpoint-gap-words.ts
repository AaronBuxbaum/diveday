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
 * People marked not back aboard have been marked: they are worded on their
 * own, never as "not marked" (dive-domain review, 2026-10-16).
 */
export function checkpointGapLine(t: StaffTranslator, gap: CheckpointGap): string {
  const dive = rollCallCheckpointOrdinal(gap.checkpoint);
  if (gap.kind === "not_counted") {
    return t("manifest.checkpointGap.notCounted", { dive, plan: plannedDivesWithout(gap) });
  }
  const unmarked = unmarkedLine(t, gap.divers, gap.crew, dive);
  if (gap.missing === 0) return unmarked ?? "";
  if (!unmarked) return t("manifest.checkpointGap.lineMissing", { missing: gap.missing, dive });
  return `${unmarked} ${t("manifest.checkpointGap.lineMissingToo", { missing: gap.missing })}`;
}

/** Those nobody has marked yet, or null when everyone has a result. */
function unmarkedLine(t: StaffTranslator, divers: number, crew: number, dive: number) {
  if (divers + crew === 0) return null;
  if (crew === 0) return t("manifest.checkpointGap.lineDivers", { divers, dive });
  if (divers === 0) return t("manifest.checkpointGap.lineCrew", { crew, dive });
  return t("manifest.checkpointGap.lineBoth", { divers, crew, dive });
}
