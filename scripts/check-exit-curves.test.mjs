import { describe, expect, it } from "vitest";

import { findExitAnimations, findExitCurveViolations, isExitName } from "./check-exit-curves.mjs";

/**
 * The check's judgement, not its plumbing. It exists because a rule written
 * down in `docs/design/principles.md` §5 and applied at one call site left
 * three exits on the arrival curve for weeks (issue #756), so what matters is
 * that it sees every shape an exit is written in and none of the entrances that
 * sit beside them in the same stylesheet.
 */

const violations = (css) => findExitCurveViolations(css).map((found) => found.name);

describe("which keyframe names read as an exit", () => {
  /**
   * `slide-out-right` is the reason this is word-wise rather than a `-out$`
   * suffix: it is one of the three exits the check was written for, and a
   * suffix pattern misses it entirely.
   */
  it("reads `out` and `dismiss` as words, wherever in the name they fall", () => {
    for (const name of ["scale-out", "slide-out-right", "board-menu-out", "toast-dismiss"]) {
      expect(isExitName(name), name).toBe(true);
    }
  });

  it("leaves the arrivals alone", () => {
    for (const name of ["rise-in", "fade-in", "slide-in-right", "scale-in", "board-menu-in"]) {
      expect(isExitName(name), name).toBe(false);
    }
  });

  /**
   * Both of these contain the letters, and neither is a departure. A substring
   * match would flag the app's own bubble animation as an exit on the wrong
   * curve and teach the next author that this check cries wolf.
   */
  it("does not read the letters out of a word that merely contains them", () => {
    expect(isExitName("sub-surface-ripple")).toBe(false);
    expect(isExitName("outline-pulse")).toBe(false);
    expect(isExitName("dismissal-shadow")).toBe(false);
  });
});

describe("what the exit-curve check refuses", () => {
  it("catches an exit left on the arrival curve", () => {
    expect(
      violations(
        ".toast-dismiss {\n  animation: toast-dismiss 200ms var(--ease-out-soft) both;\n}",
      ),
    ).toEqual(["toast-dismiss"]);
  });

  it("passes an exit that leaves on the leaving curve", () => {
    expect(
      violations(".animate-scale-out {\n  animation: scale-out 180ms var(--ease-in-soft) both;\n}"),
    ).toEqual([]);
  });

  /**
   * The `animation` shorthand's own default is `ease`, not the app's
   * `--default-transition-timing-function` — that one governs `transition`. So
   * an exit that names no curve is on a fourth curve nobody chose, which is the
   * defect issue #833 found in the transitions and is worth catching here
   * before it repeats.
   */
  it("catches an exit that names no curve at all", () => {
    expect(violations(".animate-scale-out {\n  animation: scale-out 180ms both;\n}")).toEqual([
      "scale-out",
    ]);
  });

  /**
   * Splitting the name from the curve across two declarations is the obvious
   * way past a check that reads the shorthand, so the longhand is refused
   * outright rather than parsed.
   */
  it("refuses the longhand, which would hide the curve from this check", () => {
    expect(
      violations(
        ".animate-scale-out {\n  animation-name: scale-out;\n  animation-timing-function: var(--ease-in-soft);\n}",
      ),
    ).toEqual(["scale-out"]);
  });

  /**
   * A rule can be renamed away from its keyframe. `.animate-scale-out` is what
   * a component reaches for, so the selector is held to the rule too.
   */
  it("reads the selector as well as the keyframe name", () => {
    expect(
      violations(".animate-scale-out {\n  animation: puff 180ms var(--ease-out-soft) both;\n}"),
    ).toEqual(["puff"]);
  });

  it("says nothing about an arrival on the arrival curve", () => {
    expect(
      violations(".rise-in {\n  animation: rise-in 200ms var(--ease-out-soft) both;\n}"),
    ).toEqual([]);
  });

  /**
   * The reduced-motion kill-switch names no keyframe, and the check must not
   * try to read one out of it.
   */
  it("ignores the reduced-motion kill-switch", () => {
    const css =
      "@media (prefers-reduced-motion: reduce) {\n  * {\n    animation: none !important;\n  }\n}";
    expect(findExitAnimations(css)).toEqual([]);
  });

  it("honours an exemption on the declaration or the line above it", () => {
    const onTheLine =
      ".animate-scale-out {\n  animation: scale-out 180ms var(--ease-out-soft) both; /* diveday:allow-exit-curve: it arrives */\n}";
    const above =
      ".animate-scale-out {\n  /* diveday:allow-exit-curve: it arrives */\n  animation: scale-out 180ms var(--ease-out-soft) both;\n}";
    expect(violations(onTheLine)).toEqual([]);
    expect(violations(above)).toEqual([]);
  });
});
