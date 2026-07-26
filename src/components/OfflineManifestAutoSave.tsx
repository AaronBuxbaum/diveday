"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  primeOfflineManifestShell,
  purgeOfflineManifestsExceptShop,
  saveOfflineManifest,
} from "@/lib/offline-manifest-store";
import type { OfflineManifestPayload } from "@/lib/offline-manifests";

// Matches the single-trip auto-save cadence (OfflineManifestManager) — see
// ADR 20260726-shopwide-offline-manifest-priming. No UI: this mounts on every
// staff shop page, and the per-trip manifest page (and the offline shell's
// own list) remain the visible surfaces that tell staff their device copy is
// current. A failure here has nowhere to surface and no user action to
// prompt, so it's silently best-effort — the next trigger (interval, focus,
// reconnect) tries again.
const AUTO_SAVE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Primes the offline shell and saves a device copy for every trip in the
 * shop's rolling 48-hour window (server-side windowing lives in
 * GET /api/offline-manifests/upcoming), independent of whether staff opened
 * any particular trip's own live manifest page. Mounted once in the shop
 * layout so it runs no matter which staff page is open — including a trip's
 * own manifest page, where OfflineManifestManager already runs its own save
 * timer for that one trip. The two can both call saveOfflineManifest for the
 * same trip around the same time; that's an accepted, harmless overlap
 * (saveOfflineManifest is idempotent and cheap), not a bug to dedupe.
 */
export function OfflineManifestAutoSave() {
  const inFlight = useRef<Promise<void> | null>(null);

  const run = useCallback((): Promise<void> => {
    if (!navigator.onLine) return Promise.resolve();
    if (inFlight.current) return inFlight.current;
    const task = (async () => {
      try {
        const response = await fetch("/api/offline-manifests/upcoming", {
          credentials: "same-origin",
        });
        if (!response.ok) return;
        const body = (await response.json()) as {
          shop: { slug: string };
          payloads: OfflineManifestPayload[];
        };
        // Server-verified "who am I signed in as" — never a client-supplied
        // value — so a device that just switched shops (a shared boat tablet,
        // a freelance captain, a reassigned device) stops holding the
        // previous shop's cached rosters the moment this runs. See ADR
        // 20260726-shopwide-offline-manifest-priming. Deliberately not
        // caught here: if the purge itself fails, saving this shop's trips
        // anyway would leave both shops' rosters readable side by side in
        // the device-wide list — fail the whole round (the outer catch
        // below) and let the next trigger retry the purge first, rather than
        // fail open on a cross-tenant boundary.
        await purgeOfflineManifestsExceptShop(body.shop.slug);
        // Shell priming is unrelated to the purge above (it only caches the
        // data-free offline shell/static assets for later offline access) and
        // must never gate it — a Cache Storage failure here used to throw
        // into the outer catch *before* the fetch/purge ran at all, letting a
        // device that just signed into a new shop keep the previous shop's
        // roster readable on every retry until priming happened to succeed.
        await primeOfflineManifestShell().catch(() => {});
        await Promise.all(
          body.payloads.map((payload) => saveOfflineManifest(payload).catch(() => {})),
        );
      } catch {
        // Best-effort — see module comment.
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
