"use client";

import { useEffect, useRef, useState } from "react";
import type { TripStage } from "@/lib/trip-stages";

/**
 * **The boat drifts in when the crew says it is underway** — ADR
 * 20260904-reef-all-the-way-down, decision 2, Budget rule 2.
 *
 * The third of the three things the widened budget lets move, and the only one
 * that is a *drawing*. It is an arrival rather than an exit: the boat slides
 * 12px into its resting place, once, at the moment the stage becomes
 * `underway`.
 *
 * Four guards, each of which the rule names:
 *
 * - **Once, and only on a transition this reader watched.** A `null` ref until
 *   the first effect runs, so a page that *arrives* already underway does not
 *   animate — the same first-paint guard `StationSettles` carries. A boat that
 *   left an hour ago is a fact, not a thing that just happened.
 * - **Never while a field has focus.** A drawing that moves under a staffer
 *   mid-sentence is the failure the rule was written against, so the animation
 *   is skipped outright when the active element is an input, a textarea, a
 *   select or anything contenteditable.
 * - **600ms and `--ease-out-soft`**, which is the budget's ceiling, enforced by
 *   `illustration.test.ts` against `globals.css` rather than by this comment.
 * - **Dead under `prefers-reduced-motion`**, through the same kill-switch in
 *   `globals.css` every other motion in this app passes through.
 */
export function BoatDrift({
  stage,
  children,
}: {
  stage: TripStage | null | undefined;
  children: React.ReactNode;
}) {
  const seen = useRef<TripStage | null | undefined>(null);
  const [drifting, setDrifting] = useState(false);

  useEffect(() => {
    const previous = seen.current;
    seen.current = stage;
    // `null` is the first-paint marker: whatever the stage is on arrival, it
    // is a state rather than a change.
    if (previous === null) return;
    if (previous === stage || stage !== "underway") return;
    const focused = document.activeElement;
    if (focused?.closest("input, textarea, select, [contenteditable]")) return;
    setDrifting(true);
  }, [stage]);

  return (
    <span
      className={drifting ? "boat-leaves" : undefined}
      onAnimationEnd={drifting ? () => setDrifting(false) : undefined}
    >
      {children}
    </span>
  );
}
