import { wipeOfflineMedicalAlerts } from "@/lib/offline-manifest-store";
import { forgetReadyPageCopy } from "@/lib/ready-offline";
import { markDeviceCleanupIncomplete } from "./device-cleanup-warning";
import { forgetAllKeptTyped } from "./KeepTypedOnRefusal";
import { forgetRevealedMedicalAlerts } from "./MedicalAlertReveal";
import { forgetAllRecents } from "./search/palette-recents";
import { announceSessionInvalidation } from "./session-invalidation";

/** How long a sign-out waits for the offline wipes before it goes on regardless. */
const WIPE_WAIT_MS = 2_000;

/**
 * **Attempt cleanup on a shared device** (security review F2,
 * N1): ⌘K's recents, any form kept for a refusal, the medical alerts
 * revealed in this visit, the medical alert words on every offline copy
 * (H-20261023-medical-alert-for-the amendment; the rest of each copy stays, queued roll call included),
 * and any diver's `/ready` page kept on this browser (issue #2693).
 * Run by both sign-out doors and by the sign-in page, where every ended
 * session lands (expiry, a disabled account, a sign-out elsewhere), so the
 * clear does not depend on somebody pressing Sign out.
 *
 * The sign-out doors await it (security review 2, L4), so the navigation
 * does not cut the IndexedDB wipe short; it gives up after `WIPE_WAIT_MS` so
 * a stuck store never keeps someone signed in. A session that ends without
 * the sign-in page loading (the browser closed, the session expiring on the
 * offline page) runs none of this: the words stay on the device until the
 * copy expires or the next sign-in (ADR 20260718 amendment, H-20261023-medical-alert-for-the).
 */
/** The result covers reported offline sensitive cleanup, not full device erasure. */
export async function forgetThisDevice(): Promise<{
  offlineSensitiveCleanupReportedComplete: boolean;
}> {
  let localComplete = true;
  for (const clear of [
    announceSessionInvalidation,
    forgetAllRecents,
    forgetAllKeptTyped,
    forgetRevealedMedicalAlerts,
  ]) {
    try {
      clear();
    } catch {
      localComplete = false;
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    Promise.allSettled([
      // An unavailable API does not establish that no saved copy exists.
      Promise.resolve().then(async () => {
        if (typeof indexedDB === "undefined") return false;
        await wipeOfflineMedicalAlerts();
        return true;
      }),
      // A diver's /ready page this browser kept (issue #2693): a shop tablet
      // that opened a diver's link keeps nothing of them past a sign-out.
      Promise.resolve().then(() => forgetReadyPageCopy()),
    ]),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), WIPE_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
  const outcome = {
    offlineSensitiveCleanupReportedComplete:
      localComplete &&
      (result?.every((item) => item.status === "fulfilled" && item.value !== false) ?? false),
  };
  if (!outcome.offlineSensitiveCleanupReportedComplete) markDeviceCleanupIncomplete();
  return outcome;
}
