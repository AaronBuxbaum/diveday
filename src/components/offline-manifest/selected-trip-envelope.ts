import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useRef,
} from "react";
import type { OfflineManifestTranslator } from "@/i18n/offline-manifest-messages";
import { isRollCallCheckpoint, type RollCallCheckpoint } from "@/lib/manifests";
import type { OfflineManifestEnvelope } from "@/lib/offline-manifests";
import { type ObservedTripShop, observeTripShopChange, type SavedCopyAction } from "./saved-copy";
import { initialTripStatusMessage } from "./trip-status";

export function useSelectedTripEnvelopeHandler({
  tripId,
  verifiedTenantSlugRef,
  dispatchSaved,
  setCheckpoint,
  tripNoticeForEnvelope,
  tripPurgedRef,
  setMessage,
  t,
  reconcile,
}: {
  tripId: string;
  verifiedTenantSlugRef: MutableRefObject<string | null>;
  dispatchSaved: Dispatch<SavedCopyAction>;
  setCheckpoint: Dispatch<SetStateAction<RollCallCheckpoint>>;
  tripNoticeForEnvelope: (saved: OfflineManifestEnvelope | null) => string | null;
  tripPurgedRef: MutableRefObject<boolean>;
  setMessage: Dispatch<SetStateAction<string>>;
  t: OfflineManifestTranslator;
  reconcile: () => Promise<void>;
}) {
  const observedTripShopRef = useRef<ObservedTripShop>(null);
  const statusInitializedForTripRef = useRef<string | null>(null);
  return useCallback(
    (saved: OfflineManifestEnvelope | null) => {
      observeTripShopChange(
        observedTripShopRef,
        tripId,
        saved,
        verifiedTenantSlugRef.current,
        dispatchSaved,
      );
      dispatchSaved({ type: "loaded", envelope: saved });
      const plannedDives = saved?.snapshot.manifests[0]?.trip.plannedDives;
      if (plannedDives !== undefined) {
        setCheckpoint((current) =>
          isRollCallCheckpoint(current, plannedDives) ? current : "departure",
        );
      }
      const noteMessage = tripNoticeForEnvelope(saved);
      if (!tripPurgedRef.current) {
        // A cold read may find nothing, then a cross-tab invalidation may find
        // a saved copy. Establish its starting status when that copy first
        // appears. Later invalidations can be caused by this tab's own recorder;
        // replacing the explicit save confirmation would hide a successful tap.
        if (statusInitializedForTripRef.current !== tripId) {
          setMessage(initialTripStatusMessage(noteMessage, Boolean(saved), t));
          if (saved) statusInitializedForTripRef.current = tripId;
        }
      }
      if (saved && navigator.onLine && !tripPurgedRef.current) void reconcile();
    },
    [
      dispatchSaved,
      reconcile,
      setCheckpoint,
      setMessage,
      t,
      tripId,
      tripNoticeForEnvelope,
      tripPurgedRef,
      verifiedTenantSlugRef,
    ],
  );
}
