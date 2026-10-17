"use client";

import { useEffect, useState } from "react";
import { MAP_REACHABILITY_PROBE } from "@/lib/maps";

/**
 * **Has the map host answered?** One probe image per mount, asked only once
 * `active` (a frame on screen), and with the radio off only once the signal
 * comes back; a failed probe is asked again on `online` or when the page is
 * visible again, never in a loop, and nothing asks after a success. The frame's own `load` fires for the browser's
 * error page as well, so the probe decides. Shared by the drawn-route frame
 * (`MapFrame`, UX review 2026-10-10 item 20) and the meeting point's map on
 * `/ready` (`ArrivalMap`, fourth UX review item 4), so one bar of signal at
 * the marina or a network that blocks the host draws no empty block on
 * either.
 */
export function useMapReachable(active: boolean): boolean {
  return useMapState(active) === "reachable";
}

/** Where the map host stands: not yet answered, answered, or given up on. */
export type MapState = "waiting" | "reachable" | "failed";

/**
 * The same probe, saying which of three it is (issue #2013): `failed` once the
 * probe errors or, with `giveUpMs`, once that long passes with no answer. A
 * blocked host errors at once; a stalled one never answers, so the silence is
 * read as failure, and an answer that comes late still wins.
 */
export function useMapState(active: boolean, giveUpMs?: number): MapState {
  const [reachable, setReachable] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (!active) return;
    let settled = false;
    const probes: HTMLImageElement[] = [];
    // **A failed probe is asked again** (issue #2669), once the signal comes
    // back or the page is looked at again, never on a timer: one bar at the
    // car park should not cost the diver the map at the dock.
    const retry = () => {
      if (document.visibilityState === "hidden") return;
      ask();
    };
    const stopRetrying = () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", retry);
    };
    const retryLater = () => {
      if (settled) return;
      stopRetrying();
      window.addEventListener("online", retry);
      document.addEventListener("visibilitychange", retry);
    };
    const giveUp =
      giveUpMs === undefined
        ? undefined
        : setTimeout(() => {
            if (settled) return;
            setGaveUp(true);
            retryLater();
          }, giveUpMs);
    const ask = () => {
      window.removeEventListener("online", ask);
      stopRetrying();
      const probe = new Image();
      probes.push(probe);
      // Google learns that something asked, never which page.
      probe.referrerPolicy = "no-referrer";
      probe.onload = () => {
        if (settled) return;
        // One answer is enough: nothing asks again after it.
        settled = true;
        clearTimeout(giveUp);
        stopRetrying();
        setReachable(true);
        setGaveUp(false);
      };
      // Said, not left to a missing handler: the frame stays hidden.
      probe.onerror = () => {
        if (settled) return;
        setReachable(false);
        setGaveUp(true);
        retryLater();
      };
      probe.src = MAP_REACHABILITY_PROBE;
    };
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      window.addEventListener("online", ask);
    } else {
      ask();
    }
    return () => {
      settled = true;
      clearTimeout(giveUp);
      window.removeEventListener("online", ask);
      stopRetrying();
      for (const probe of probes) {
        probe.onload = null;
        probe.onerror = null;
      }
    };
  }, [active, giveUpMs]);
  return reachable ? "reachable" : gaveUp ? "failed" : "waiting";
}
