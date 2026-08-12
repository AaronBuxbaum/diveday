"use client";

import { useEffect, useRef, useState } from "react";

/**
 * How long the moment stays on screen. Long enough to read at a glance on a
 * moving boat, short enough that it can never become furniture: a line that
 * stayed would be "no blockers" rendered as a status, which is the thing
 * design principle 9 forbids and the thing this deliberately is not.
 */
const VISIBLE_MS = 4000;

/**
 * The all-clear moment: the roster's last readiness blocker just cleared.
 *
 * "Everyone on this boat can dive" is the finished thing a shop works toward
 * every morning, and until now the only feedback for reaching it was the
 * absence of red (docs/design/principles.md #3 — joy is reserved for finished
 * things, and this is one).
 *
 * **Why a client component at all.** The moment is the *transition*, not the
 * state: blocked > 0 becoming blocked = 0 because of an action this staffer
 * just took. A server render cannot tell those apart — a boat that was already
 * clear when the page loaded has nothing to celebrate, and celebrating it would
 * turn the moment into exactly the persistent all-clear banner this avoids. So
 * the count arrives as a prop and the previous render's value is remembered
 * here; the first render after mount can never fire, which is also what makes
 * it gone on reload.
 *
 * Motion is the shared `rise-in` class (opacity + transform, 200ms), so the
 * `prefers-reduced-motion` kill-switch in globals.css already covers it and
 * there is no fourth near-duplicate keyframe. Words come in as a prop: staff
 * copy is resolved server-side (AGENTS.md).
 */
export function RosterAllClear({ blockedCount, label }: { blockedCount: number; label: string }) {
  // Seeded with the mount-time count, so `wasBlocked` is false on the first
  // effect run and a page that loads already-clear stays quiet.
  const previousCount = useRef(blockedCount);
  const [celebrating, setCelebrating] = useState(false);

  useEffect(() => {
    const wasBlocked = previousCount.current > 0;
    previousCount.current = blockedCount;
    // A diver who *becomes* blocked mid-moment takes the moment away with them:
    // this sits directly above a list that would then show a blocker, and a
    // stale "everyone's cleared" over a blocked roster is worse than no
    // celebration at all on a surface that decides who boards.
    if (blockedCount > 0) {
      setCelebrating(false);
      return;
    }
    if (!wasBlocked) return;
    setCelebrating(true);
    const timer = setTimeout(() => setCelebrating(false), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [blockedCount]);

  if (!celebrating) return null;

  // Coral as a *fill* with its own foreground token, never coral ink on the
  // page: `text-accent` at this size measures ~2.9:1 on `--surface`, under AA,
  // which is the same trap `Badge`'s success/warning tones documented and
  // solved with their `-strong` variants (coral has none). The token pair
  // clears 4.5:1 in both schemes, and a fill is what makes this read as a
  // moment rather than as another muted line in the header.
  //
  // `role="status"` so it is announced rather than only seen — the staffer who
  // cleared the last blocker may be reading this with a screen reader, and "the
  // red went away" is not an announcement.
  return (
    <p className="mt-1">
      <span
        role="status"
        className="rise-in inline-flex items-center rounded-full bg-accent px-3 py-1 text-sm font-medium text-accent-foreground"
      >
        {label}
      </span>
    </p>
  );
}
