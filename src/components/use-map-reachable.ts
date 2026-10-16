"use client";

import { useEffect, useState } from "react";
import { MAP_REACHABILITY_PROBE } from "@/lib/maps";

/**
 * **Has the map host answered?** One probe image per mount, asked only once
 * `active` (a frame on screen), and with the radio off only once the signal
 * comes back, never in a loop. The frame's own `load` fires for the browser's
 * error page as well, so the probe decides. Shared by the drawn-route frame
 * (`MapFrame`, UX review 2026-10-10 item 20) and the meeting point's map on
 * `/ready` (`ArrivalMap`, fourth UX review item 4), so one bar of signal at
 * the marina or a network that blocks the host draws no empty block on
 * either.
 */
export function useMapReachable(active: boolean): boolean {
  const [reachable, setReachable] = useState(false);
  useEffect(() => {
    if (!active) return;
    let settled = false;
    let probe: HTMLImageElement | null = null;
    const ask = () => {
      window.removeEventListener("online", ask);
      probe = new Image();
      // Google learns that something asked, never which page.
      probe.referrerPolicy = "no-referrer";
      probe.onload = () => {
        if (!settled) setReachable(true);
      };
      // Said, not left to a missing handler: the frame stays hidden.
      probe.onerror = () => {
        if (!settled) setReachable(false);
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
      window.removeEventListener("online", ask);
      if (probe) {
        probe.onload = null;
        probe.onerror = null;
      }
    };
  }, [active]);
  return reachable;
}
