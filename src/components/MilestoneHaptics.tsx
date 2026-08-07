"use client";

import { useEffect, useRef } from "react";

/**
 * Fires a milestone haptic buzz as roll-call progress crosses 25/50/75/100%.
 * `prevPct`/`isInitial` assume a monotonic same-trip, same-checkpoint
 * lifecycle — they only know "went up from last render", not which trip or
 * checkpoint that was. The caller (manifest/page.tsx) must render this with
 * `key={`${tripId}-${checkpoint}`}` so a trip or checkpoint switch fully
 * remounts it instead of comparing today's numbers against a different
 * trip's carried-forward refs (docs ADR 20260801-cache-components-activity-state).
 */
export function MilestoneHaptics({ total, boarded }: { total: number; boarded: number }) {
  const isInitial = useRef(true);
  const prevPct = useRef(0);

  const pct = total > 0 ? Math.round((boarded / total) * 100) : 0;

  useEffect(() => {
    if (isInitial.current) {
      isInitial.current = false;
      prevPct.current = pct;
      return;
    }

    if (pct !== prevPct.current) {
      if (pct > prevPct.current) {
        if (typeof window !== "undefined" && "vibrate" in navigator) {
          try {
            if (pct === 100) {
              navigator.vibrate([100, 50, 100, 50, 200]);
            } else if (pct >= 75 && prevPct.current < 75) {
              navigator.vibrate([20, 50, 20, 50, 20]);
            } else if (pct >= 50 && prevPct.current < 50) {
              navigator.vibrate([20, 50, 20]);
            } else if (pct >= 25 && prevPct.current < 25) {
              navigator.vibrate(20);
            }
          } catch (err) {
            // A haptic is decoration — worth a trace, never an error-level
            // alarm nobody can act on.
            console.warn("Vibration failed:", err);
          }
        }
      }
      prevPct.current = pct;
    }
  }, [pct]);

  return null;
}
