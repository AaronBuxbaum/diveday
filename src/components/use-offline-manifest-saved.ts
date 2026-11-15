"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadOfflineManifest, subscribeOfflineManifestChanges } from "@/lib/offline-manifest-store";
import type { OfflineManifestEnvelope } from "@/lib/offline-manifests";

/** Keep the device summary responsive to worker writes without blocking sync. */
export function useOfflineManifestSaved(
  tripId: string,
  onReload: (envelope: OfflineManifestEnvelope | null, externalSync: boolean) => void,
) {
  const [savedState, setSavedState] = useState<OfflineManifestEnvelope | null>(null);
  const savedRevision = useRef(0);
  const reloadRef = useRef<() => void>(() => {});
  const currentTrip = useRef(tripId);
  const onReloadRef = useRef(onReload);
  onReloadRef.current = onReload;
  currentTrip.current = tripId;
  const setSaved = useCallback(
    (envelope: OfflineManifestEnvelope | null, expectedRevision?: number) => {
      if (currentTrip.current !== tripId) return false;
      if (envelope && envelope.snapshot.manifests[0]?.trip.id !== tripId) return false;
      if (expectedRevision !== undefined && expectedRevision !== savedRevision.current) {
        reloadRef.current();
        return false;
      }
      savedRevision.current += 1;
      setSavedState(envelope);
      return true;
    },
    [tripId],
  );
  const saved = savedState?.snapshot.manifests[0]?.trip.id === tripId ? savedState : null;

  useEffect(() => {
    if (!tripId) return;
    let active = true;
    let request = 0;
    let externalSync = false;
    const reload = () => {
      const currentRequest = ++request;
      const revision = savedRevision.current;
      void loadOfflineManifest(tripId)
        .then((envelope) => {
          if (!active || currentRequest !== request) return;
          if (revision !== savedRevision.current) {
            reload();
            return;
          }
          if (setSaved(envelope)) {
            const observedSync = externalSync;
            externalSync = false;
            onReloadRef.current(envelope, observedSync);
          }
        })
        .catch(() => {});
    };
    reloadRef.current = reload;
    const invalidateAndReload = () => {
      savedRevision.current += 1;
      reload();
    };
    const unsubscribe = subscribeOfflineManifestChanges((changedTripId, source) => {
      if (changedTripId === tripId && source.origin === "other-context-broadcast") {
        if (source.reason === "sync") externalSync = true;
        invalidateAndReload();
      }
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") invalidateAndReload();
    };
    window.addEventListener("focus", invalidateAndReload);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      if (reloadRef.current === reload) reloadRef.current = () => {};
      unsubscribe();
      window.removeEventListener("focus", invalidateAndReload);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tripId, setSaved]);

  return { saved, setSaved, savedRevision };
}
