import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef } from "react";
import type { OfflineManifestTranslator } from "@/i18n/offline-manifest-messages";
import { loadOfflineManifest, subscribeOfflineManifestChanges } from "@/lib/offline-manifest-store";
import type { OfflineManifestEnvelope } from "@/lib/offline-manifests";

export type SelectedTripStorageState = {
  changeRevision: number;
  readRequest: number;
  reload: () => void;
};

export function createSelectedTripStorageState(): SelectedTripStorageState {
  return { changeRevision: 0, readRequest: 0, reload: () => {} };
}

export function useSelectedTripPurgeState(setMessage: Dispatch<SetStateAction<string>>) {
  const tripPurgedRef = useRef(false);
  const onTripPurged = useCallback(() => {
    tripPurgedRef.current = true;
    setMessage("");
  }, [setMessage]);
  return { tripPurgedRef, onTripPurged };
}

/** Re-read the selected encrypted copy after another tab commits a trip write. */
export function useSelectedTripStorage({
  tripId,
  verifiedTenantRevision,
  tripPurgedRef,
  storageStateRef,
  onEnvelope,
  onReadStarted,
  onOnline,
  setMessage,
  t,
  setStoreRead,
  setStoreReadFailed,
  refreshDiscarded,
}: {
  tripId: string;
  verifiedTenantRevision: number;
  tripPurgedRef: { current: boolean };
  storageStateRef: { current: SelectedTripStorageState };
  onEnvelope: (saved: OfflineManifestEnvelope | null) => void;
  onReadStarted: () => void;
  onOnline: () => void;
  setMessage: Dispatch<SetStateAction<string>>;
  t: OfflineManifestTranslator;
  setStoreRead: (read: boolean) => void;
  setStoreReadFailed: (failed: boolean) => void;
  refreshDiscarded: () => void;
}) {
  useEffect(() => {
    if (!tripId) return;
    let active = true;
    const reload = () => {
      const state = storageStateRef.current;
      const request = ++state.readRequest;
      const changeRevision = state.changeRevision;
      onReadStarted();
      void loadOfflineManifest(tripId)
        .then((saved) => {
          const current = storageStateRef.current;
          if (
            !active ||
            request !== current.readRequest ||
            changeRevision !== current.changeRevision ||
            tripPurgedRef.current
          ) {
            return;
          }
          onEnvelope(saved);
          setStoreRead(true);
          setStoreReadFailed(false);
        })
        .catch(() => {
          const current = storageStateRef.current;
          if (
            !active ||
            request !== current.readRequest ||
            changeRevision !== current.changeRevision ||
            tripPurgedRef.current
          ) {
            return;
          }
          setStoreReadFailed(true);
          setMessage(t("shared.offlineManifest.reconcile.singleLoadError"));
        });
    };
    storageStateRef.current.reload = reload;
    const unsubscribe = subscribeOfflineManifestChanges((changedTripId) => {
      if (changedTripId !== tripId) return;
      storageStateRef.current.changeRevision += 1;
      reload();
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    const onNetworkOnline = () => queueMicrotask(onOnline);
    window.addEventListener("focus", reload);
    window.addEventListener("online", onNetworkOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      storageStateRef.current.readRequest += 1;
      if (storageStateRef.current.reload === reload) {
        storageStateRef.current.reload = () => {};
      }
      unsubscribe();
      window.removeEventListener("focus", reload);
      window.removeEventListener("online", onNetworkOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [
    tripId,
    tripPurgedRef,
    storageStateRef,
    onEnvelope,
    onReadStarted,
    onOnline,
    setMessage,
    t,
    setStoreRead,
    setStoreReadFailed,
  ]);

  useEffect(() => {
    if (!tripId) return;
    let active = true;
    if (verifiedTenantRevision > 0) setStoreReadFailed(false);
    tripPurgedRef.current = false;
    onReadStarted();
    const state = storageStateRef.current;
    const request = ++state.readRequest;
    const changeRevision = state.changeRevision;
    void loadOfflineManifest(tripId)
      .then((saved) => {
        const current = storageStateRef.current;
        if (!active || request !== current.readRequest) return;
        if (changeRevision !== current.changeRevision) {
          current.reload();
          return;
        }
        onEnvelope(saved);
        setStoreReadFailed(false);
      })
      .catch(() => {
        if (active && request === storageStateRef.current.readRequest) {
          setStoreReadFailed(true);
          setMessage(t("shared.offlineManifest.reconcile.singleLoadError"));
        }
      })
      .finally(() => {
        if (active && request === storageStateRef.current.readRequest) {
          setStoreRead(true);
          refreshDiscarded();
        }
      });
    return () => {
      active = false;
      if (storageStateRef.current.readRequest === request) {
        storageStateRef.current.readRequest += 1;
      }
    };
  }, [
    tripId,
    verifiedTenantRevision,
    tripPurgedRef,
    storageStateRef,
    onEnvelope,
    onReadStarted,
    refreshDiscarded,
    setStoreRead,
    setStoreReadFailed,
    setMessage,
    t,
  ]);
}
