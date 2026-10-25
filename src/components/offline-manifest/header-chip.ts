import type { OfflineManifestFreshness } from "@/lib/offline-manifests";

/**
 * **The saved copy's one chip** (visual review 2026-10-24, B51). "Online"
 * and "Fresh copy" stood side by side and said one thing; they are one chip
 * now, and every other case keeps the single chip it had:
 *
 * - **Offline, or DiveDay did not answer**: the connectivity chip, which is
 *   the warning that matters ("Offline · using saved copy"). A copy the
 *   worker opened because DiveDay was silent never says "Fresh", however
 *   young it is: it is not the live list.
 * - **Online and current**: "Fresh copy · online".
 * - **Online and aging or stale**: that freshness chip alone; the age is
 *   the question, and "online" would read as reassurance it is not.
 *
 * The banner under the header says the freshness in a sentence every time,
 * so no case loses "when it was saved".
 */
export type OfflineHeaderChip =
  | { kind: "connectivity" }
  | { kind: "freshness"; freshness: OfflineManifestFreshness; online: boolean };

export function offlineHeaderChip(input: {
  online: boolean;
  servedWithoutAnswer: boolean;
  freshness: OfflineManifestFreshness;
}): OfflineHeaderChip {
  if (!input.online || input.servedWithoutAnswer) return { kind: "connectivity" };
  return {
    kind: "freshness",
    freshness: input.freshness,
    online: input.freshness === "current",
  };
}
