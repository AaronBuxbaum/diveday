"use client";

import { useEffect, useRef, useState } from "react";
import { fill } from "@/i18n/fill";

export type WaterLockerCopy = {
  rainAlt: string;
  heading: string;
  body: string;
  holdLine1: string;
  holdLine2: string;
  unlockingProgress: string;
  holdToUnlock: string;
};

export function WaterLocker({ copy }: { copy: WaterLockerCopy }) {
  const [isLocked, setIsLocked] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const touchHistory = useRef<{ x: number; y: number; time: number }[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
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
  }, []);

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

  if (!isLocked) return null;

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
