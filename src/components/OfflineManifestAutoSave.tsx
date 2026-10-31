"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  beginOfflineTenantVerificationRound,
  primeOfflineManifestShell,
  purgeOfflineManifestsExceptShop,
  saveOfflineManifest,
  wipeOfflineMedicalAlerts,
} from "@/lib/offline-manifest-store";
import {
  offlineManifestMayHoldMedicalAlertWords,
  offlineManifestPayloads,
  offlineManifestShopSlug,
  offlineManifestViewerPersonId,
} from "@/lib/offline-manifests";

// Matches the single-trip cadence in OfflineManifestManager (ADR
// 20260726-shopwide-offline-manifest-priming). No UI: failures have nowhere
// to surface, so they are silently best-effort and the next trigger
// (interval, focus, reconnect) retries.
const AUTO_SAVE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Primes the offline shell and saves a device copy of every trip in the
 * shop's rolling 48-hour window (windowed server-side by
 * GET /api/offline-manifests/upcoming), whichever staff page is open. Mounted
 * once in the shop layout. Overlap with OfflineManifestManager's per-trip
 * save on the same trip is accepted: saveOfflineManifest is idempotent.
 */
export function OfflineManifestAutoSave() {
  const inFlight = useRef<Promise<void> | null>(null);

  const run = useCallback((): Promise<void> => {
    if (!navigator.onLine) return Promise.resolve();
    if (inFlight.current) return inFlight.current;
    const task = (async () => {
      // Independent of the fetch/purge/save sequence below: the shell is
      // static and shop-agnostic, and must prime even if the upcoming fetch
      // fails, so a device never lacks its root-path offline fallback.
      // primeOfflineManifestShell() dedupes overlapping callers, so no await.
      void primeOfflineManifestShell().catch(() => {});
      try {
        const tenantRound = await beginOfflineTenantVerificationRound();
        const response = await fetch("/api/offline-manifests/upcoming", {
          credentials: "same-origin",
        });
        if (!response.ok) return;
        // Parsed, never cast: an unchecked body could yield an undefined slug
        // that matches no saved record, so the device-wide purge would delete every one.
        const body: unknown = await response.json();
        // Server-verified viewer's shop, never client-supplied, so a device
        // that switched shops drops the previous shop's rosters on this run.
        // Taken from this response, not /identity, to avoid a second request.
        const shopSlug = offlineManifestShopSlug(body);
        // No tenant, no round: saving without a purge is a cross-tenant leak.
        if (!shopSlug) return;
        // Not caught on purpose: a failed purge fails the round so the next
        // trigger retries it first, rather than saving across tenants.
        await purgeOfflineManifestsExceptShop(shopSlug, tenantRound);
        // Medical alert words saved by another person on this device are
        // wiped before saving. An unnamed viewer wipes all of them (fail closed).
        await wipeOfflineMedicalAlerts(
          offlineManifestViewerPersonId(body) ?? undefined,
          tenantRound,
        );
        await Promise.all(
          offlineManifestPayloads(body).map((payload) =>
            saveOfflineManifest(payload, {
              // Words this viewer may no longer hold go (security review 2, L3).
              keepMedicalAlertWords: offlineManifestMayHoldMedicalAlertWords(
                body,
                payload.manifests[0]?.trip.id,
              ),
              tenantRound,
            }).catch(() => {}),
          ),
        );
      } catch {
        // Best-effort; see the module comment.
      }
    })().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = task;
    return task;
  }, []);

  useEffect(() => {
    void run();
    const onOnline = () => {
      if (navigator.onLine) void run();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void run();
    };
    const interval = setInterval(() => {
      if (navigator.onLine) void run();
    }, AUTO_SAVE_INTERVAL_MS);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  }, [run]);

  return null;
}
