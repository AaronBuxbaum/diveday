import { type MutableRefObject, useCallback, useEffect } from "react";
import {
  listOfflineManifests,
  subscribeOfflineManifestChanges,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import type { OfflineManifestEnvelope } from "@/lib/offline-manifests";
import { pendingOfflineEventCount } from "@/lib/offline-manifests";

function isShopChanged(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && error.code === "shop_changed"
  );
}

export function hasForeignPendingManifestChanges(
  envelopes: readonly OfflineManifestEnvelope[],
  currentShopSlug: string | null,
): boolean {
  return (
    currentShopSlug !== null &&
    envelopes.some(
      (envelope) =>
        envelope.snapshot.shop.slug !== currentShopSlug && pendingOfflineEventCount(envelope) > 0,
    )
  );
}

/** Use the selected copy as the newest inventory row for its trip. */
export function foreignPendingTrip(
  inventory: readonly OfflineManifestEnvelope[],
  selected: OfflineManifestEnvelope | null,
  currentShopSlug: string | null,
): boolean {
  if (!selected) return hasForeignPendingManifestChanges(inventory, currentShopSlug);
  const tripId = selected.snapshot.manifests[0]?.trip.id;
  const latest = tripId
    ? inventory.filter((envelope) => envelope.snapshot.manifests[0]?.trip.id !== tripId)
    : inventory;
  return hasForeignPendingManifestChanges([...latest, selected], currentShopSlug);
}

export function useTripPendingManifestInventory({
  tripId,
  tenantSlugRef,
  verifiedTenantRevision,
  inventoryReadyRef,
  setList,
  setMessage,
  onInventoryReady,
  allCaughtUpMessage,
}: {
  tripId: string;
  tenantSlugRef: { current: string | null };
  verifiedTenantRevision: number;
  inventoryReadyRef: MutableRefObject<boolean>;
  setList: (saved: OfflineManifestEnvelope[]) => void;
  setMessage: (update: (message: string) => string) => void;
  onInventoryReady: (saved: OfflineManifestEnvelope[]) => void;
  allCaughtUpMessage: string;
}) {
  useEffect(() => {
    if (!tripId) return;
    let active = true;
    let latestRequest = 0;
    const refresh = () => {
      const request = ++latestRequest;
      // A new read makes the previous inventory stale. Until this tenant's
      // latest read settles, selected-trip sync must not claim everything was
      // sent: the device-wide pending queue may contain another shop's work.
      inventoryReadyRef.current = false;
      void listOfflineManifests()
        .then((saved) => {
          if (!active || request !== latestRequest) return;
          setList(saved);
          inventoryReadyRef.current = true;
          onInventoryReady(saved);
          if (
            verifiedTenantRevision > 0 &&
            hasForeignPendingManifestChanges(saved, tenantSlugRef.current) &&
            allCaughtUpMessage
          ) {
            setMessage((message) => (message === allCaughtUpMessage ? "" : message));
          }
        })
        .catch(() => {
          // An unreadable or failed inventory is not evidence that there are
          // no foreign pending events. Keep caught-up copy suppressed.
        });
    };
    refresh();
    const unsubscribe = subscribeOfflineManifestChanges(() => refresh());
    window.addEventListener("online", refresh);
    return () => {
      active = false;
      latestRequest += 1;
      inventoryReadyRef.current = false;
      unsubscribe();
      window.removeEventListener("online", refresh);
    };
  }, [
    tripId,
    tenantSlugRef,
    verifiedTenantRevision,
    inventoryReadyRef,
    setList,
    setMessage,
    onInventoryReady,
    allCaughtUpMessage,
  ]);
}

export function useSavedManifestList({
  tenantSlugRef,
  getTenantRound,
  initialListMessage,
  reconciledListMessage,
  setList,
  setMessage,
  handleTenantChanged,
}: {
  tenantSlugRef: { current: string | null };
  getTenantRound: () => number | null;
  initialListMessage: (saved: OfflineManifestEnvelope[], shopSlug: string) => string;
  reconciledListMessage: (saved: OfflineManifestEnvelope[], shopSlug: string) => string;
  setList: (saved: OfflineManifestEnvelope[]) => void;
  setMessage: (message: string) => void;
  handleTenantChanged: () => void;
}) {
  return useCallback(
    async (saved: OfflineManifestEnvelope[], currentShopSlug: string | null) => {
      if (!currentShopSlug) return;
      const authorized = saved.filter(
        (envelope) => envelope.snapshot.shop.slug === currentShopSlug,
      );
      if (tenantSlugRef.current === currentShopSlug) {
        setMessage(initialListMessage(authorized, currentShopSlug));
      }
      if (!navigator.onLine) return;
      const reconcilable = saved.filter(
        (envelope) =>
          envelope.snapshot.shop.slug === currentShopSlug && pendingOfflineEventCount(envelope) > 0,
      );
      if (reconcilable.length === 0) return;

      let shopChanged = false;
      const results = await Promise.all(
        reconcilable.map((envelope) => {
          const id = envelope.snapshot.manifests[0]?.trip.id;
          return id
            ? syncOfflineManifest(id, currentShopSlug, getTenantRound() ?? undefined).catch(
                (error) => {
                  if (isShopChanged(error) && !shopChanged) {
                    shopChanged = true;
                    // Quarantine on the first explicit mismatch. Another
                    // trip sync can remain pending indefinitely; waiting for
                    // Promise.all would keep this tenant's roster actionable.
                    handleTenantChanged();
                  }
                  return null;
                },
              )
            : Promise.resolve(null);
        }),
      );
      if (shopChanged) return;
      if (tenantSlugRef.current !== currentShopSlug) return;
      const byId = new Map(
        results
          .filter((envelope): envelope is OfflineManifestEnvelope => envelope !== null)
          .map((envelope) => [envelope.snapshot.manifests[0]?.trip.id ?? "", envelope] as const),
      );
      const merged = saved.map((envelope) => {
        const id = envelope.snapshot.manifests[0]?.trip.id;
        return id && byId.has(id) ? (byId.get(id) as OfflineManifestEnvelope) : envelope;
      });
      setList(merged);
      setMessage(reconciledListMessage(merged, currentShopSlug));
    },
    [
      tenantSlugRef,
      getTenantRound,
      initialListMessage,
      reconciledListMessage,
      setList,
      setMessage,
      handleTenantChanged,
    ],
  );
}
