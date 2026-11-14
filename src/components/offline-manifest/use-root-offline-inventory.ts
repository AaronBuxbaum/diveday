import { type Dispatch, type MutableRefObject, type SetStateAction, useEffect } from "react";
import type { OfflineManifestTranslator } from "@/i18n/offline-manifest-messages";
import { readOfflineManifestInventory } from "@/lib/offline-manifest-store";
import type { OfflineManifestEnvelope } from "@/lib/offline-manifests";
import type { useSavedManifestList } from "./use-saved-manifest-list";

/** Load the root inventory locally before attempting authenticated reconciliation. */
export function useRootOfflineInventory({
  tripId,
  verifiedTenantRevision,
  tripPurgedRef,
  setList,
  setMessage,
  setStoreRead,
  setStoreReadFailed,
  setInventoryIncomplete,
  initialMessageForList,
  reconcileList,
  resolveTenant,
  refreshDiscarded,
  t,
}: {
  tripId: string;
  verifiedTenantRevision: number;
  tripPurgedRef: MutableRefObject<boolean>;
  setList: Dispatch<SetStateAction<OfflineManifestEnvelope[] | null>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setStoreRead: Dispatch<SetStateAction<boolean>>;
  setStoreReadFailed: Dispatch<SetStateAction<boolean>>;
  setInventoryIncomplete: Dispatch<SetStateAction<boolean>>;
  initialMessageForList: (saved: OfflineManifestEnvelope[]) => string;
  reconcileList: ReturnType<typeof useSavedManifestList>;
  resolveTenant: () => Promise<string | null>;
  refreshDiscarded: () => void;
  t: OfflineManifestTranslator;
}) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: A newly verified session triggers a fresh inventory read.
  useEffect(() => {
    if (tripId) return;
    let active = true;
    let revision = 0;
    tripPurgedRef.current = false;
    const refreshList = () => {
      const requested = ++revision;
      const isCurrent = () => active && requested === revision;
      return readOfflineManifestInventory()
        .then(async ({ manifests: saved, incomplete }) => {
          if (!isCurrent()) return;
          setList(saved);
          setMessage(initialMessageForList(saved));
          if (incomplete) {
            setStoreReadFailed(true);
            setInventoryIncomplete(true);
            setMessage("");
            setStoreRead(true);
            const tenant = await resolveTenant();
            if (isCurrent()) void reconcileList(saved, tenant, true, isCurrent);
            return;
          }
          setStoreReadFailed(false);
          setInventoryIncomplete(false);
          setStoreRead(true);
          const tenant = await resolveTenant();
          if (isCurrent()) void reconcileList(saved, tenant, false, isCurrent);
        })
        .catch(() => {
          if (!isCurrent()) return;
          setStoreReadFailed(true);
          setInventoryIncomplete(true);
          setMessage(t("shared.offlineManifest.reconcile.listLoadError"));
        })
        .finally(() => {
          if (!isCurrent()) return;
          setStoreRead(true);
          refreshDiscarded();
        });
    };
    void refreshList();
    window.addEventListener("online", refreshList);
    return () => {
      active = false;
      revision += 1;
      window.removeEventListener("online", refreshList);
    };
  }, [
    reconcileList,
    refreshDiscarded,
    resolveTenant,
    tripId,
    t,
    verifiedTenantRevision,
    initialMessageForList,
    tripPurgedRef,
    setList,
    setMessage,
    setStoreRead,
    setStoreReadFailed,
    setInventoryIncomplete,
  ]);
}
