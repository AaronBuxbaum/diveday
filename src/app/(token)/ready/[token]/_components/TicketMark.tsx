"use client";

import { useEffect, useState } from "react";
import { LOGO_MARK_CIRCLES, LOGO_MARK_VIEWBOX } from "@/components/Logo";

/**
 * **The bubble mark on the booked ticket, rising once** (issue #4386).
 *
 * The three bubbles of the mark come up one after another the first time a
 * diver opens their ticket for this departure, and sit still on every later
 * open (back, or a kept tab): a celebration replayed is one that stops meaning
 * anything (ADR 20260827-clearwater-surface-language, decision 11). The motion
 * is the existing `rise-in` (transform and opacity only), staggered, and the
 * reduced-motion kill-switch in globals.css zeroes it with its delays.
 *
 * Which departures have risen is a per-browser convenience in `localStorage`,
 * keyed by the departure and never by the page's token. Storage that throws or
 * is empty only means the bubbles rise again, which is harmless.
 *
 * Before hydration the bubbles are transparent, so a returning diver never
 * sees them drop and rise; the mark is decoration (`aria-hidden`), and the
 * ticket says everything without it.
 */
export function TicketMark({ tripId, className = "" }: { tripId: string; className?: string }) {
  const [phase, setPhase] = useState<"waiting" | "rise" | "still">("waiting");

  useEffect(() => {
    const key = `diveday.ticket-risen.${tripId}`;
    let risen = false;
    try {
      risen = window.localStorage.getItem(key) === "1";
      if (!risen) window.localStorage.setItem(key, "1");
    } catch {
      // Private window or blocked storage: let it rise.
    }
    setPhase(risen ? "still" : "rise");
  }, [tripId]);

  return (
    <svg
      viewBox={`0 0 ${LOGO_MARK_VIEWBOX} ${LOGO_MARK_VIEWBOX}`}
      className={`text-primary ${className}`.trim()}
      aria-hidden="true"
      data-ticket-mark={phase}
    >
      {LOGO_MARK_CIRCLES.map((circle, index) => (
        <circle
          key={`${circle.cx},${circle.cy}`}
          cx={circle.cx}
          cy={circle.cy}
          r={circle.r}
          fill={circle.tone === "accent" ? "var(--accent)" : "currentColor"}
          // The mark's own shading rides `fill-opacity`, so the entrance's
          // opacity (0 to 1) never flattens the middle bubble.
          fillOpacity={circle.opacity === 1 ? undefined : circle.opacity}
          opacity={phase === "waiting" ? 0 : undefined}
          className={phase === "rise" ? "rise-in" : undefined}
          style={phase === "rise" ? { animationDelay: `${index * 140}ms` } : undefined}
        />
      ))}
    </svg>
  );
}
