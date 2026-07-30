import type { RollCallCheckpoint } from "@/lib/manifests";
import type { StaffTranslator } from "./staff-messages";

/**
 * A roll-call checkpoint's staff-facing word ("Before departure" / "After
 * dive N"). `RollCallCheckpoint` (src/lib/manifests.ts) is already the code —
 * `"departure"` or `` `after_dive_${number}` `` — so there is nothing for the
 * lib layer to hand back beyond that value itself; this is the staff-bundle
 * resolver every staff surface renders it through (manifest/page.tsx,
 * OfflineManifestView.tsx), with the dive number passed as an ICU `{n}`
 * placeholder rather than string concatenation.
 */
export function rollCallCheckpointText(t: StaffTranslator, checkpoint: RollCallCheckpoint): string {
  if (checkpoint === "departure") return t("shared.rollCallCheckpoint.departure");
  const n = Number(checkpoint.slice("after_dive_".length));
  return t("shared.rollCallCheckpoint.afterDive", { n });
}
