import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MOTION_RUNGS } from "@/lib/motion";

/**
 * **The motion language, checked against the stylesheet that carries it.**
 *
 * The three easing curves were declared in `:root` and argued for at length
 * there, and almost nothing used them — because Tailwind only generates
 * utilities from `@theme`, so there was no `ease-out-soft` class to reach for,
 * and `--default-transition-timing-function` was left at Tailwind's own curve.
 * An author writing the obvious thing got a fourth curve nobody chose: 31 of
 * the app's 35 transitions were on it (issue #833).
 *
 * That failure is invisible from the source — `:root` is a perfectly good
 * place for a custom property and the hand-written keyframes always resolved
 * it correctly. What tells the two apart is *which block* the declaration sits
 * in, which is what this reads.
 *
 * Compiling Tailwind here would be the stronger check and is what I did by
 * hand while writing this; it is not worth a postcss run in the unit suite for
 * a fact that only changes when someone edits these ten lines.
 */
const CSS = readFileSync(path.join(import.meta.dirname, "globals.css"), "utf8");

/** The `@theme` block Tailwind reads, as opposed to `@theme inline` or `:root`. */
const themeBlock = (() => {
  const start = CSS.indexOf("@theme {");
  expect(start, "globals.css has a plain `@theme` block").toBeGreaterThan(-1);
  return CSS.slice(start, CSS.indexOf("\n}", start));
})();

describe("the motion tokens", () => {
  it("declares every curve where Tailwind will emit a utility for it", () => {
    for (const token of ["--ease-out-soft", "--ease-in-soft", "--ease-spring"]) {
      expect(themeBlock, token).toContain(`${token}:`);
    }
  });

  /**
   * The line that corrected 31 transitions without touching a component. A
   * bare `transition-colors` is the *correct* thing to write now, which is why
   * there is deliberately no lint rule banning one.
   */
  it("points the default curve and duration at the app's own arrival", () => {
    expect(themeBlock).toContain("--default-transition-timing-function: var(--ease-out-soft)");
    expect(themeBlock).toContain("--default-transition-duration: var(--motion-base)");
  });

  /**
   * **The ladder is one ladder, in two languages.**
   *
   * CSS owns the motion; JS owns the timers that let an exit finish before
   * React unmounts the node. Before this, every one of those timers was a
   * keyframe's number copied into another file under a comment asking the next
   * reader to keep the two in step — and nothing failed when the CSS moved and
   * the copy did not, because a half-played exit reads as a stutter rather than
   * as a bug (ADR 20260907-nothing-from-nowhere, decision 2).
   *
   * Reading the stylesheet here is what makes `motionMs("base")` a promise
   * rather than a second opinion.
   */
  it("states the same three rungs to JS as it does to CSS", () => {
    for (const [rung, ms] of Object.entries(MOTION_RUNGS)) {
      expect(themeBlock, `--motion-${rung}`).toContain(`--motion-${rung}: ${ms}ms;`);
    }
  });

  /**
   * The rungs are the whole vocabulary, so a keyframe with a hand-written
   * duration is either a new speed nobody agreed to or a rung spelled as a
   * number. The two ceilings principle 5 grants are the exceptions and are
   * listed by name: a ceiling is a limit rather than a speed.
   */
  it("runs every animation utility off a rung, bar the drawn moments", () => {
    // Each of these is a drawn moment rather than a speed — the water closing
    // over finished work, the boat leaving, and the marketing hero's one
    // reveal. They state a duration because they *are* the exception the
    // 600ms ceiling exists for, so the ceiling is asserted below rather than
    // waived.
    const MOMENTS = [
      "swell-across",
      "boat-leaves",
      "marketing-device-arrive",
      "marketing-roll-call-settle",
    ];
    const literals = [...CSS.matchAll(/animation:\s*([\w-]+)\s+(\d+)ms/g)];
    expect(
      literals.filter(([, name]) => !MOMENTS.includes(name)).map(([, n, ms]) => `${n} ${ms}ms`),
      "a duration in milliseconds where a rung belongs",
    ).toEqual([]);
    for (const [, name, ms] of literals) {
      expect(
        Number(ms),
        `${name} is a drawn moment and sits under the ceiling`,
      ).toBeLessThanOrEqual(600);
    }
  });

  it("keeps the curves out of :root, where they generated nothing", () => {
    const root = CSS.slice(CSS.indexOf(":root {"), CSS.indexOf("@theme {"));
    expect(root).not.toContain("--ease-out-soft:");
  });

  /**
   * `.card-scale-hint` animated `box-shadow` — paint, every frame, against
   * principle 5 — with a literal `rgba(0, 0, 0, 0.05)` that is invisible on the
   * dark palette. Half the readers paid for an effect none of them saw.
   */
  it("carries no dead motion utility", () => {
    // `.card-scale-hint` and `.progress-wave-fill` each sat unused for weeks
    // — a hover cue and a looping wave nothing mounted. A utility no
    // component reaches for does not come back.
    expect(CSS).not.toMatch(/^\.card-scale-hint/m);
    expect(CSS).not.toMatch(/^\.progress-wave-fill/m);
  });
});
