"use client";

import { useEffect, useRef, useState } from "react";

export type SubSurfaceRippleCopy = { iconTitle: string; message: string };

/**
 * Plays a full-screen completion ripple the instant `complete` flips from
 * false to true. `prevComplete` assumes a monotonic same-trip, same-checkpoint
 * lifecycle — it only knows "just became complete", not which trip or
 * checkpoint that was. The caller (manifest/page.tsx) must render this with
 * `key={`${tripId}-${checkpoint}`}` so a trip or checkpoint switch fully
 * remounts it instead of comparing against a different trip's carried-forward
 * ref (docs ADR 20260801-cache-components-activity-state).
 */
export function SubSurfaceRipple({
  complete,
  copy,
}: {
  complete: boolean;
  copy: SubSurfaceRippleCopy;
}) {
  const [active, setActive] = useState(false);
  const prevComplete = useRef(complete);

  useEffect(() => {
    // Only trigger when complete changes from false to true
    if (complete && !prevComplete.current) {
      setActive(true);
      const timer = setTimeout(() => {
        setActive(false);
      }, 3000); // 3 seconds duration
      return () => clearTimeout(timer);
    }
    prevComplete.current = complete;
  }, [complete]);

  if (!active) return null;

  return (
    <div
      data-testid="sub-surface-ripple"
      className="sub-surface-ripple-overlay"
      role="status"
      aria-live="polite"
    >
      <div className="sub-surface-ripple-ring" />
      <div className="sub-surface-ripple-message">
        <svg
          className="w-12 h-12 text-primary"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          aria-hidden="true"
        >
          <title>{copy.iconTitle}</title>
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span className="text-lg font-black tracking-wider uppercase text-primary">
          {copy.message}
        </span>
      </div>
    </div>
  );
}
