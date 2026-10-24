import { wipeOfflineMedicalAlerts } from "@/lib/offline-manifest-store";
import { forgetReadyPageCopy } from "@/lib/ready-offline";
import { forgetAllKeptTyped } from "./KeepTypedOnRefusal";
import { forgetRevealedMedicalAlerts } from "./MedicalAlertReveal";
import { forgetAllRecents } from "./search/palette-recents";

/** How long a sign-out waits for the offline wipes before it goes on regardless. */
const WIPE_WAIT_MS = 2_000;

/**
 * **A shared device keeps nothing of the last staffer** (security review F2,
 * N1): ⌘K's recents, any form kept for a refusal, the medical alerts
 * revealed in this visit, the medical alert words on every offline copy
 * (H-153 amendment; the rest of each copy stays, queued roll call included),
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
 * copy expires or the next sign-in (ADR 20260718 amendment, H-153).
 */
export async function forgetThisDevice(): Promise<void> {
  forgetAllRecents();
  forgetAllKeptTyped();
  forgetRevealedMedicalAlerts();
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all([
      // A browser with no IndexedDB has no copies.
      typeof indexedDB === "undefined" ? undefined : wipeOfflineMedicalAlerts().catch(() => {}),
      // A diver's /ready page this browser kept (issue #2693): a shop tablet
      // that opened a diver's link keeps nothing of them past a sign-out.
      forgetReadyPageCopy(),
    ]),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, WIPE_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
}
