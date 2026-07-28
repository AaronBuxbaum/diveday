"use client";

import { useEffect, useRef } from "react";

export function MilestoneHaptics({ total, awaiting }: { total: number; awaiting: number }) {
  const isInitial = useRef(true);
  const prevPct = useRef(0);

  const boarded = total - awaiting;
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
            console.error("Vibration failed:", err);
          }
        }
      }
      prevPct.current = pct;
    }
  }, [pct]);

  return null;
}
