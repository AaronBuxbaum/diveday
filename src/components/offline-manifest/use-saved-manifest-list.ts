import { useCallback } from "react";
import { syncOfflineManifest } from "@/lib/offline-manifest-store";
import type { OfflineManifestEnvelope } from "@/lib/offline-manifests";
import { pendingOfflineEventCount } from "@/lib/offline-manifests";

function isShopChanged(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && error.code === "shop_changed"
  );
}

export function useSavedManifestList({
  tenantSlugRef,
  initialListMessage,
  reconciledListMessage,
  setList,
  setMessage,
  handleTenantChanged,
}: {
  tenantSlugRef: { current: string | null };
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
            ? syncOfflineManifest(id, currentShopSlug).catch((error) => {
                if (isShopChanged(error)) {
                  shopChanged = true;
                }
                return null;
              })
            : Promise.resolve(null);
        }),
      );
      if (shopChanged) {
        handleTenantChanged();
        return;
      }
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
      initialListMessage,
      reconciledListMessage,
      setList,
      setMessage,
      handleTenantChanged,
    ],
  );
}
