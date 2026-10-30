/**
 * **The motion ladder for JavaScript timers** — ADR 20260907-nothing-from-nowhere,
 * decision 2.
 *
 * CSS owns motion; JavaScript uses these durations only to keep timers paired
 * with CSS animations through unmount. `globals.css` declares the same three
 * tokens, and `src/app/motion-tokens.test.ts` checks their parity. Timers name
 * a rung instead of repeating its number.
 *
 * The ladder is intentionally not read from computed CSS: it is unavailable
 * on the server and can be empty in jsdom. The 400ms disclosure and 600ms drawn
 * moment limits are ceilings, not speeds; callers state their reason.
 */

/** The three speeds, in milliseconds. The stylesheet declares the same three. */
export const MOTION_RUNGS = {
  /** A scrim fading, a control letting go, a pressed row lifting. */
  quick: 150,
  /**
   * The app's default for a figure rolling, row sliding, disclosure, toast,
   * sheet or panel.
   */
  base: 200,
  /** A group of controls unfolding or folding, per child, staggered. */
  unfold: 280,
} as const;

export type MotionRung = keyof typeof MOTION_RUNGS;

/**
 * How long a rung lasts, for a JS timer that must outlast the CSS it pairs
 * with. Name the rung the stylesheet names; never write the number.
 */
export function motionMs(rung: MotionRung): number {
  return MOTION_RUNGS[rung];
}

/**
 * Whether this reader asked for reduced motion, answered safely anywhere.
 *
 * The stylesheet's kill-switch shortens every duration and delay to nothing,
 * which is the whole answer for anything CSS drives. It is not the answer for
 * motion a component *computes* — a FLIP slide measuring positions, a figure
 * deciding whether to roll — where the honest response is to skip the work
 * rather than to run it at 0.01ms.
 *
 * Fails toward motion, like every other "cannot tell" default in this app:
 * `matchMedia` is absent on the server and undefined in jsdom, and a reader who
 * has expressed no preference is the common case.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
