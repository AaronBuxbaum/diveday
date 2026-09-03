"use client";

import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { getActiveOfflineShellVersion } from "@/lib/offline-manifest-store";
import { OFFLINE_MANIFEST_SHELL_VERSION } from "@/lib/offline-manifests";

export type OfflineShellVersionBannerCopy = {
  staleBanner: string;
  updateBanner: string;
  refreshButton: string;
};

/**
 * A deploy that lands while a device is offline leaves its service worker —
 * and the shell it serves from cache — on whatever version it last
 * installed, with no signal anything changed (`manifest-sw.js` calls
 * `skipWaiting()` silently). This covers the two distinct moments that
 * matters for: the *currently active* worker already predates this page's
 * own build (a stale saved copy — compared against
 * `OFFLINE_MANIFEST_SHELL_VERSION`), and a *new* worker taking over
 * mid-session (an update just landed; refreshing picks it up). Task 124 /
 * persona 15 (Leo).
 */
export function OfflineShellVersionBanner({ copy }: { copy: OfflineShellVersionBannerCopy }) {
  const [stale, setStale] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getActiveOfflineShellVersion().then((version) => {
      if (!cancelled && version && version !== OFFLINE_MANIFEST_SHELL_VERSION) setStale(true);
    });
    if (!("serviceWorker" in navigator)) return;
    const onControllerChange = () => setUpdateReady(true);
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  // A freshly activated worker takes priority over the stale-on-load check —
  // it means an update is already sitting there ready, which a reload
  // resolves outright, so there's nothing left to warn about separately.
  if (updateReady) {
    return (
      <p className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-accent/40 bg-accent/10 p-3 text-sm font-semibold">
        {copy.updateBanner}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {copy.refreshButton}
        </button>
      </p>
    );
  }

  if (stale) {
    return (
      <p className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm font-semibold">
        {copy.staleBanner}
      </p>
    );
  }

  return null;
}
