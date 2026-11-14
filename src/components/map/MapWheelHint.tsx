"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

/** Explain wheel zoom only after a reader tries to scroll over the map. */
export function MapWheelHint({ hint, children }: { hint: string; children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <div
      className="relative h-full w-full"
      onWheelCapture={(event) => {
        if (timer.current) clearTimeout(timer.current);
        if (event.metaKey || event.ctrlKey) {
          setVisible(false);
          return;
        }
        setVisible(true);
        timer.current = setTimeout(() => setVisible(false), 1800);
      }}
    >
      {children}
      {visible ? (
        <div className="pointer-events-none absolute inset-x-4 top-1/2 z-[1100] flex -translate-y-1/2 justify-center">
          <p
            role="status"
            className="rounded-lg bg-surface px-3 py-2 text-center text-sm text-foreground shadow-md"
          >
            {hint}
          </p>
        </div>
      ) : null}
    </div>
  );
}
