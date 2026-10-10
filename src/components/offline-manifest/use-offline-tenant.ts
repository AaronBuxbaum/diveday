import { useCallback, useRef } from "react";
import { fetchOfflineManifestShopSlug } from "@/lib/offline-manifests";

/**
 * **Which shop this browser is signed in as**, asked of the server once per
 * round and shared by every caller on the page.
 */
export function useOfflineTenant() {
  /**
   * The server-verified tenant, cached for this mount. The purge effect below
   * refreshes it on load and on every reconnect; this is the cheap read for the
   * call sites that only need to *check* it (a captain tapping Board should not
   * pay for a request).
   */
  const tenantSlugRef = useRef<string | null>(null);
  /**
   * The in-flight lookup, so the purge effect and the branch effect below share
   * one request instead of racing two on every mount and every reconnect
   * (security review, 2026-08-06). The endpoint is now identity-only rather
   * than the whole 48-hour roster (review 20260802, action item 12), so a
   * duplicate costs far less than it did — but the dedupe stays: on a marina
   * connection each of these can sit for the full ten-second timeout, and two
   * of them can disagree, which would have the purge and the reconcile pass
   * acting on two different answers to "which shop is this".
   *
   * The lookup itself now lives in `src/lib/offline-manifests.ts`
   * (`fetchOfflineManifestShopSlug`), shared with the service worker's own
   * flush pass — it asks the same tenant question for the same reason and must
   * not answer it differently (security review, 2026-08-06).
   */
  const tenantLookupRef = useRef<Promise<string | null> | null>(null);

  const resolveTenant = useCallback(async (): Promise<string | null> => {
    if (tenantSlugRef.current) return tenantSlugRef.current;
    tenantLookupRef.current ??= fetchOfflineManifestShopSlug().finally(() => {
      tenantLookupRef.current = null;
    });
    const slug = await tenantLookupRef.current;
    if (slug) tenantSlugRef.current = slug;
    return slug;
  }, []);
  return { tenantSlugRef, resolveTenant };
}
