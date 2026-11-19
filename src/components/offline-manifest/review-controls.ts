import { type Dispatch, type MutableRefObject, useEffect, useMemo, useState } from "react";
import { type OfflineManifestEnvelope, offlineFallbackReason } from "@/lib/offline-manifests";
import type { CopyCaveat } from "./controls";
import type { SavedCopyAction } from "./saved-copy";
import { useDeviceOnline } from "./use-device-online";
import type { SelectedTripStorageState } from "./use-selected-trip-storage";

/** Keep the saved copy's age current while the screen remains open. */
export function useFreshnessTick() {
  const [, forceFreshnessRecompute] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => forceFreshnessRecompute((tick) => tick + 1), 60_000);
    return () => clearInterval(interval);
  }, []);
}

/** A worker fallback remains distinct from a copy deliberately opened online. */
export function useCopyCaveat(searchParams: Pick<URLSearchParams, "get">) {
  const deviceOnline = useDeviceOnline();
  const fallback = useMemo(() => offlineFallbackReason(searchParams), [searchParams]);
  const servedWithoutAnswer = fallback !== null && deviceOnline;
  const copyCaveat: CopyCaveat = !deviceOnline
    ? "offline"
    : servedWithoutAnswer
      ? "unanswered"
      : "online";
  return { fallback, servedWithoutAnswer, copyCaveat };
}

/** A late review response may update the screen only in its verified tenant and trip. */
export function offlineReviewControls(
  resolveTenant: () => Promise<string | null>,
  getTenantRound: () => number | null,
  verifiedTenantSlugRef: MutableRefObject<string | null>,
  selectedTripStorageRef: MutableRefObject<SelectedTripStorageState>,
  tripId: string | null,
  dispatchSaved: Dispatch<SavedCopyAction>,
) {
  return {
    async reviewTenant() {
      const shopSlug = await resolveTenant();
      const round = getTenantRound();
      if (!shopSlug || round === null || shopSlug !== verifiedTenantSlugRef.current) return null;
      return { shopSlug, round };
    },
    onReviewEnvelope(next: OfflineManifestEnvelope) {
      if (
        next.snapshot.shop.slug !== verifiedTenantSlugRef.current ||
        next.snapshot.manifests[0]?.trip.id !== tripId
      )
        return;
      selectedTripStorageRef.current.changeRevision += 1;
      dispatchSaved({ type: "loaded", envelope: next });
    },
  };
}
