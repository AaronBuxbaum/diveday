"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The water closes over finished work — Reef's first moment (ADR
 * 20260901-diveday-reimagined, slice 13g).
 *
 * A station's rows are the morning's work on one boat. When the last of them
 * clears — the staffer handled the help request, the waiver came back, the
 * seat was paid for — the rows do not simply vanish and leave the station
 * shorter: a swell draws across the space they held and the station settles
 * into one warm sentence. The morning's work visibly finishing is the feeling
 * a shop pays for.
 *
 * **It renders nothing until it has been earned.** A station that *arrives*
 * with no work is quiet, exactly as it was before this slice; the sentence and
 * the swell exist only for a station whose rows this reader watched clear, on
 * this page, without a reload. That is the same first-paint guard
 * `SettledCheck` and `CounterClearedLine` carry — a `null` ref until the first
 * effect runs, so a mount holding zero rows cannot be mistaken for a count
 * that just fell to zero. A page of twelve clear boats does not draw twelve
 * swells on arrival, and a boat that cleared an hour ago is a fact, not a
 * thing that just happened.
 *
 * **Two rules the drawing keeps.** The swell is lagoon, never coral: the home
 * renders one coral element ever, resolved in `DaySpine.tsx`, and this is not
 * it. And it is a single 400ms pass — the swell crosses and fades within
 * 320ms, the sentence rises behind it — after which only the words remain;
 * the reduced-motion kill-switch in `globals.css` zeroes both, so that reader
 * sees the rows swap for the sentence and nothing move.
 *
 * Work that comes back — a new booking on a cleared boat, a waiver rescinded —
 * takes the sentence away again and shows the rows; the next clear earns the
 * moment afresh.
 */
/** The `swell-across` run in `globals.css`; the clock fallback below reads it. */
const SWELL_MS = 320;

export function StationSettles({
  rowCount,
  sentence,
  children,
}: {
  /** How many rows the station currently hangs beneath it. */
  rowCount: number;
  /** The warm sentence, resolved by the server component above. */
  sentence: string;
  /** The rows themselves. */
  children: React.ReactNode;
}) {
  // `null` until the first effect runs, which is what distinguishes "this
  // mounted already clear" from "it had work a moment ago and now has none".
  const previous = useRef<number | null>(null);
  const [settled, setSettled] = useState(false);
  const [swelling, setSwelling] = useState(false);

  useEffect(() => {
    const firstPaint = previous.current === null;
    const cleared = previous.current !== null && previous.current > 0 && rowCount === 0;
    previous.current = rowCount;
    if (firstPaint) return;
    if (cleared) {
      setSettled(true);
      setSwelling(true);
    } else if (rowCount > 0) {
      setSettled(false);
      setSwelling(false);
    }
  }, [rowCount]);

  // `onAnimationEnd` is the swell's own end, and it never comes for a station
  // inside a closed disclosure — tomorrow's and the week's boats sit in
  // `<details>`, where no animation runs — which would leave the water waiting
  // to cross the moment the reader opens it, hours after the work cleared. So
  // the flag also falls on the clock, at the animation's own length plus a
  // frame: whichever comes first ends the moment, and a swell that never
  // played is never played late.
  useEffect(() => {
    if (!swelling) return;
    const id = setTimeout(() => setSwelling(false), SWELL_MS + 16);
    return () => clearTimeout(id);
  }, [swelling]);

  if (rowCount > 0 || !settled) return <>{children}</>;

  return (
    <div className="mt-4">
      {swelling ? (
        <svg
          aria-hidden="true"
          data-station-swell
          viewBox="0 0 260 26"
          preserveAspectRatio="none"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
          onAnimationEnd={() => setSwelling(false)}
          className="swell-across h-[26px] w-full text-primary-hover"
        >
          <path
            vectorEffect="non-scaling-stroke"
            d="M0 14c26-11 52-11 78 0s52 11 78 0 52-11 78 0 22 6 26 4"
          />
          <path
            vectorEffect="non-scaling-stroke"
            d="M0 22c26-11 52-11 78 0s52 11 78 0 52-11 78 0 22 6 26 4"
            opacity={0.4}
          />
        </svg>
      ) : null}
      <p
        role="status"
        className="rise-in mt-2 text-sm font-semibold"
        style={{ animationDelay: "200ms" }}
      >
        {sentence}
      </p>
    </div>
  );
}
