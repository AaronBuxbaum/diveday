/**
 * Ask the browser to flush pending roll-call events once connectivity returns,
 * even if this page is gone by then (ADR 20260804-manifest-web-push).
 *
 * The gap this closes: `syncOfflineManifest` is otherwise only ever called
 * from the page — the reconnect listener, visibility-return, and the 5-minute
 * interval. A captain who records roll call offshore, closes the tab, and
 * drives home does not send those events until somebody reopens DiveDay, and
 * those events are the record of *who came back aboard*.
 *
 * Best-effort by construction. Background Sync is not available in Safari or
 * Firefox, and Chrome can refuse a registration; every one of those paths
 * leaves the existing page-driven triggers exactly as they were, which is why
 * this never throws and never reports failure to a caller. It is an upgrade on
 * the platforms that have it, never a dependency.
 */

/**
 * The tag the worker listens for. Exported rather than written twice: a string
 * literal in two files is a silent no-op the first time either one changes,
 * and the failure mode is "roll call quietly never sends".
 */
export const MANIFEST_SYNC_TAG = "diveday-manifest-sync";

type SyncCapableRegistration = ServiceWorkerRegistration & {
  sync?: { register: (tag: string) => Promise<void> };
};

export async function requestBackgroundFlush(): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const registration = (await navigator.serviceWorker.ready) as SyncCapableRegistration;
    // `sync` is absent entirely on Safari and Firefox — the check is the
    // feature detection, not a convenience.
    await registration.sync?.register(MANIFEST_SYNC_TAG);
  } catch {
    // A refused registration (permission, quota, an unsupported browser that
    // exposes the property anyway) changes nothing: the page's own reconnect,
    // visibility and interval triggers still run.
  }
}
