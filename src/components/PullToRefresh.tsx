"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type PullToRefreshCopy = {
  pulling: string;
  release: string;
  refreshing: string;
};

const DEFAULT_COPY: PullToRefreshCopy = {
  pulling: "Pull down to sync…",
  release: "Release to sync",
  refreshing: "Syncing…",
};

const THRESHOLD_PX = 60;
const MAX_PULL_PX = 90;

/**
 * A gesture-driven pull-to-refresh container for dockside operational views
 * (the offline manifest and the check-in queue), built to the exact same
 * contract as `BuddyDragGroups`:
 *
 * 1. Touch + pointer events in a unified path (no HTML5 drag or third-party libraries).
 * 2. Visual progress cue with resistance dampening.
 * 3. Cancel curve when released below threshold.
 * 4. Zero interference with ordinary scrolling (only activates at the top of the viewport).
 */
export function PullToRefresh({
  onRefresh,
  copy = DEFAULT_COPY,
  className = "",
  children,
}: {
  onRefresh: () => Promise<void>;
  copy?: PullToRefreshCopy;
  className?: string;
  children: React.ReactNode;
}) {
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const isPulling = useRef(false);

  const resetPull = useCallback(() => {
    startY.current = null;
    isPulling.current = false;
    setPullY(0);
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (refreshing || event.button !== 0) return;
    const scrollY = window.scrollY ?? document.documentElement.scrollTop ?? 0;
    if (scrollY <= 0) {
      startY.current = event.clientY;
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (startY.current === null || refreshing) return;
    const deltaY = event.clientY - startY.current;
    if (deltaY > 0) {
      isPulling.current = true;
      // Damped pull curve
      const damped = Math.min(deltaY ** 0.85, MAX_PULL_PX);
      setPullY(damped);
    } else {
      setPullY(0);
    }
  };

  const handlePointerUp = async () => {
    if (!isPulling.current || startY.current === null || refreshing) {
      resetPull();
      return;
    }

    if (pullY >= THRESHOLD_PX) {
      setRefreshing(true);
      setPullY(THRESHOLD_PX);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        resetPull();
      }
    } else {
      resetPull();
    }
  };

  // Prevent unwanted selection / rubberbanding during active pull
  useEffect(() => {
    if (!isPulling.current && pullY === 0) return;
    const prevent = (event: TouchEvent) => {
      if (pullY > 0) event.preventDefault();
    };
    document.addEventListener("touchmove", prevent, { passive: false });
    return () => document.removeEventListener("touchmove", prevent);
  }, [pullY]);

  const pastThreshold = pullY >= THRESHOLD_PX;
  const statusText = refreshing ? copy.refreshing : pastThreshold ? copy.release : copy.pulling;

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={resetPull}
      className={`relative min-h-full ${className}`}
    >
      <div
        aria-live="polite"
        role="status"
        style={{
          height: `${pullY}px`,
          transition: isPulling.current ? "none" : "height 200ms var(--ease-out-soft, ease-out)",
        }}
        className="overflow-hidden flex items-center justify-center text-xs font-semibold text-muted tracking-tight"
      >
        {pullY > 15 || refreshing ? (
          <div className="flex items-center gap-2 py-2">
            <span
              className={`inline-block transition-transform duration-150 ${
                refreshing
                  ? "animate-spin"
                  : pastThreshold
                    ? "rotate-180 text-primary"
                    : "rotate-0 text-muted"
              }`}
              aria-hidden="true"
            >
              ↓
            </span>
            <span>{statusText}</span>
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
