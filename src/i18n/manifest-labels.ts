import type { RollCallCheckpoint, RollCallLabel } from "@/lib/manifests";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

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

const ROLL_CALL_STATE_KEYS: Record<RollCallLabel, StaffMessageKey> = {
  awaiting: "shared.rollCallState.awaiting",
  boarded: "shared.rollCallState.boarded",
  not_boarded: "shared.rollCallState.notBoarded",
  not_boarded_carried: "shared.rollCallState.notBoardedCarried",
  not_back_aboard: "shared.rollCallState.notBackAboard",
};

/**
 * The words beside a diver's name for their roll-call state at a checkpoint.
 * `rollCallLabel` (src/lib/manifests.ts) resolves the code — including the
 * `not_back_aboard` case an after-dive checkpoint carries — and this is the one
 * resolver both the live manifest and the offline copy render it through, so
 * the two surfaces cannot describe the same diver differently.
 */
export function rollCallLabelText(t: StaffTranslator, label: RollCallLabel): string {
  return t(ROLL_CALL_STATE_KEYS[label]);
}
