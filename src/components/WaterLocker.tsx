"use client";

import { useEffect, useRef, useState } from "react";

export type WaterLockerCopy = {
  rainAlt: string;
  heading: string;
  body: string;
  holdLine1: string;
  holdLine2: string;
  unlockingProgress: string;
  holdToUnlock: string;
};

export type WaterLockerToggleCopy = {
  disableToggleLabel: string;
};

/** Fills `{name}` placeholders in a plain ICU-style template — never a translator crossing the client boundary. */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in values ? String(values[key]) : match,
  );
}

/**
 * Persisted per-device, same pattern as `AmbientGlareDetector`'s contrast
 * mode (`CONTRAST_MODE_STORAGE_KEY`/`CONTRAST_MODE_CHANGE_EVENT`): a
 * localStorage key `WaterLockerToggle` writes and a same-tab
 * `CustomEvent` broadcasts, so every `WaterLocker` mounted elsewhere on the
 * page (the live manifest, the offline view) picks up the change immediately
 * without a full reload.
 */
export const WATER_LOCKER_DISABLED_STORAGE_KEY = "diveday:water-locker-disabled";
export const WATER_LOCKER_DISABLED_CHANGE_EVENT = "diveday:water-locker-disabled-change";

function readWaterLockerDisabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(WATER_LOCKER_DISABLED_STORAGE_KEY) === "true";
  } catch (err) {
    console.warn("Failed to read spray guard preference from localStorage:", err);
    return false;
  }
}

export function WaterLocker({ copy }: { copy: WaterLockerCopy }) {
  const [isLocked, setIsLocked] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  // Starts `false` (matching what a server render would produce) and reads
  // the real preference in an effect, same defensive SSR-safe order
  // `AmbientGlareDetector`'s mode uses — this component itself never runs on
  // the server (it's mounted only from client pages), but the pattern still
  // avoids a spurious first-paint flash if that ever changes.
  const [disabled, setDisabled] = useState(false);
  const touchHistory = useRef<{ x: number; y: number; time: number }[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setDisabled(readWaterLockerDisabled());
  }, []);

  useEffect(() => {
    const handleChange = (e: Event) => {
      const detail = (e as CustomEvent<{ disabled: boolean }>)?.detail;
      if (typeof detail?.disabled === "boolean") setDisabled(detail.disabled);
    };
    window.addEventListener(WATER_LOCKER_DISABLED_CHANGE_EVENT, handleChange);
    return () => window.removeEventListener(WATER_LOCKER_DISABLED_CHANGE_EVENT, handleChange);
  }, []);

  // Disabling mid-lock releases it immediately rather than leaving a captain
  // stuck behind a hold-to-unlock screen for a feature they just turned off.
  useEffect(() => {
    if (disabled && isLocked) {
      setIsLocked(false);
      setHoldProgress(0);
    }
  }, [disabled, isLocked]);

  useEffect(() => {
    if (disabled) return;
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 2) {
        e.preventDefault();
        e.stopPropagation();
        setIsLocked(true);
        return;
      }

      const touch = e.touches[0];
      if (!touch) return;

      const now = Date.now();
      const newTouch = { x: touch.clientX, y: touch.clientY, time: now };

      touchHistory.current = touchHistory.current.filter((t) => now - t.time < 1000);

      for (const prev of touchHistory.current) {
        const dist = Math.hypot(newTouch.x - prev.x, newTouch.y - prev.y);
        const timeDiff = newTouch.time - prev.time;
        if (timeDiff > 5 && timeDiff < 150 && dist > 30) {
          e.preventDefault();
          e.stopPropagation();
          setIsLocked(true);
          touchHistory.current = [];
          return;
        }
      }

      touchHistory.current.push(newTouch);
    };

    window.addEventListener("touchstart", handleTouchStart, { capture: true, passive: false });
    return () => {
      window.removeEventListener("touchstart", handleTouchStart, { capture: true });
    };
  }, [disabled]);

  const startHold = () => {
    setHoldProgress(0);
    const start = Date.now();
    const duration = 2000;

    progressIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min((elapsed / duration) * 100, 100);
      setHoldProgress(pct);
      if (elapsed >= duration) {
        setIsLocked(false);
        setHoldProgress(0);
        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        if (timerRef.current) clearTimeout(timerRef.current);
      }
    }, 50);

    timerRef.current = setTimeout(() => {
      setIsLocked(false);
      setHoldProgress(0);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    }, duration);
  };

  const cancelHold = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    setHoldProgress(0);
  };

  if (disabled || !isLocked) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/90 p-6 backdrop-blur-md animate-fade-in">
      <div className="max-w-md text-center">
        <span className="text-5xl animate-bounce" role="img" aria-label={copy.rainAlt}>
          🌧️
        </span>
        <h2 className="mt-6 text-2xl font-bold tracking-tight">{copy.heading}</h2>
        <p className="mt-3 text-base text-muted">{copy.body}</p>

        <div className="mt-8 flex flex-col items-center gap-4">
          <button
            type="button"
            onMouseDown={startHold}
            onMouseUp={cancelHold}
            onMouseLeave={cancelHold}
            onTouchStart={(e) => {
              e.preventDefault();
              startHold();
            }}
            onTouchEnd={cancelHold}
            onKeyDown={(event) => {
              if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
                event.preventDefault();
                startHold();
              }
            }}
            onKeyUp={(event) => {
              if (event.key === "Enter" || event.key === " ") cancelHold();
            }}
            onBlur={cancelHold}
            className="relative h-20 w-20 overflow-hidden rounded-full bg-primary font-semibold text-primary-foreground shadow-lg flex items-center justify-center active:scale-95 transition-transform duration-100"
          >
            <div
              className="absolute inset-0 bg-primary-sunken origin-bottom transition-all duration-75"
              style={{ transform: `scaleY(${holdProgress / 100})` }}
            />
            <span className="relative z-10 text-xs text-center font-bold">
              {copy.holdLine1}
              <br />
              {copy.holdLine2}
            </span>
          </button>
          <p className="text-xs font-semibold text-primary uppercase tracking-wider">
            {holdProgress > 0
              ? fill(copy.unlockingProgress, { percent: Math.round(holdProgress) })
              : copy.holdToUnlock}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * A small per-device opt-out for `WaterLocker`, which otherwise mounts
 * unconditionally on every manifest surface — including a desktop with no
 * touchscreen to catch rain on. Persists like `AmbientContrastSlider`'s
 * contrast mode: localStorage plus a same-tab `CustomEvent` so any
 * already-mounted `WaterLocker` on the page (this toggle and the lock screen
 * it controls are always siblings, never the same component) picks up the
 * change without a reload.
 */
export function WaterLockerToggle({ copy }: { copy: WaterLockerToggleCopy }) {
  const [disabled, setDisabled] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDisabled(readWaterLockerDisabled());
  }, []);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.checked;
    setDisabled(next);
    try {
      localStorage.setItem(WATER_LOCKER_DISABLED_STORAGE_KEY, String(next));
    } catch (err) {
      console.warn("Failed to write spray guard preference to localStorage:", err);
    }
    window.dispatchEvent(
      new CustomEvent(WATER_LOCKER_DISABLED_CHANGE_EVENT, { detail: { disabled: next } }),
    );
  };

  // Nothing to show before the real preference has loaded from localStorage
  // — an unchecked flash-then-check would misreport "spray guard on" for a
  // device that had actually turned it off.
  if (!mounted) return null;

  return (
    <label className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-muted transition-colors hover:bg-surface-sunken hover:text-foreground print:hidden">
      <input
        type="checkbox"
        checked={disabled}
        onChange={handleChange}
        className="size-4 accent-primary"
      />
      {copy.disableToggleLabel}
    </label>
  );
}
