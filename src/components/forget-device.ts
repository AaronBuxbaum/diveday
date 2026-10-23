import { wipeOfflineMedicalAlerts } from "@/lib/offline-manifest-store";
import { forgetAllKeptTyped } from "./KeepTypedOnRefusal";
import { forgetRevealedMedicalAlerts } from "./MedicalAlertReveal";
import { forgetAllRecents } from "./search/palette-recents";

/**
 * **A shared device keeps nothing of the last staffer** (security review F2,
 * N1): ⌘K's recents, any form kept for a refusal, the medical alerts
 * revealed in this visit, and the medical alert words on every offline copy (H-153 amendment; the rest of each copy stays,
 * queued roll call included). Run by both sign-out
 * doors and by the sign-in page, where every ended session lands (expiry, a
 * disabled account, a sign-out elsewhere), so the clear does not depend on
 * somebody pressing Sign out.
 */
export function forgetThisDevice(): void {
  forgetAllRecents();
  forgetAllKeptTyped();
  forgetRevealedMedicalAlerts();
  // Best-effort and not awaited: a browser with no IndexedDB has no copies,
  // and the sign-in page runs this again for the next person either way.
  if (typeof indexedDB !== "undefined") void wipeOfflineMedicalAlerts().catch(() => {});
}
