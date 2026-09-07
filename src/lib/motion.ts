/**
 * **The motion ladder, for the half of the app that counts in milliseconds** —
 * ADR 20260907-nothing-from-nowhere, decision 2.
 *
 * CSS owns the app's motion and always has. What CSS cannot own is the timer a
 * component needs when an element has to survive its own removal: React
 * unmounts in a frame, so an exit animation only runs if something holds the
 * node on screen for exactly as long as the keyframe lasts. Every one of those
 * timers was the keyframe's number, copied by hand into another file, under a
 * comment asking the next reader to keep the two in step:
 *
 * - `MENU_CLOSE_MS = 390` in `ScheduleBuilder.tsx`, sized by hand to outlast a
 *   stagger declared three directories away
 * - `EXIT_DURATION_MS = 200` in `Toast.tsx` and again in `UndoToast.tsx`
 * - `useExitAnimation(open, 180)` at the command palette, `(open, 200)` at the
 *   dock's sheet
 *
 * Each was correct on the day it was written, which is the problem: nothing
 * fails when the CSS moves and the number does not, and the failure is a
 * half-played exit that reads as a stutter rather than as a bug.
 *
 * So the ladder is named in both languages and proved to be one ladder:
 * `globals.css` declares `--motion-quick` / `--motion-base` / `--motion-unfold`
 * in `@theme`, this file states the same three numbers, and
 * `src/app/motion-tokens.test.ts` reads the stylesheet and fails if they
 * disagree. A timer names a rung; the number lives in one place a test can
 * see.
 *
 * **Why not read the custom property at runtime.** `getComputedStyle` would
 * make drift impossible rather than merely detectable, and it cannot run on the
 * server, cannot run before the stylesheet lands, and returns `""` in jsdom —
 * so every caller would need a fallback constant, which is the copied number
 * again with an extra step.
 *
 * The two ceilings principle 5 grants are deliberately not rungs. A ceiling is
 * a limit, not a speed: 400ms for a staggered disclosure as a whole, 600ms for
 * a drawn moment. A caller that needs one states it and says why.
 */

/** The three speeds, in milliseconds. The stylesheet declares the same three. */
export const MOTION_RUNGS = {
  /** A scrim fading, a control letting go, a pressed row lifting. */
  quick: 150,
  /**
   * The app's default, and what nearly everything chose independently before
   * there was a ladder: a figure rolling, a row sliding, a disclosure body
   * arriving, a toast, a sheet leaving, a panel opening from its control.
   */
  base: 200,
  /** A group of controls unfolding or folding, per child, staggered. */
  unfold: 280,
} as const;

export type MotionRung = keyof typeof MOTION_RUNGS;

/** The stagger between children of an unfolding group, in milliseconds. */
export const MOTION_STAGGER_MS = 50;

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
