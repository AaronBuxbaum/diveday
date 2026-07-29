"use client";

import { useEffect, useRef, useState } from "react";

export function SubSurfaceRipple({ complete }: { complete: boolean }) {
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
    <div data-testid="sub-surface-ripple" className="sub-surface-ripple-overlay" aria-hidden="true">
      <div className="sub-surface-ripple-ring" />
      <div className="sub-surface-ripple-ring" />
      <div className="sub-surface-ripple-ring" />
      <div className="sub-surface-ripple-message">
        <svg
          className="w-12 h-12 text-primary"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        >
          <title>Success Checkmark</title>
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span className="text-lg font-black tracking-wider uppercase text-primary">
          Roster Complete
        </span>
      </div>
    </div>
  );
}
