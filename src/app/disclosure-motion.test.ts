import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **The disclosure's body arrives, instead of appearing.**
 *
 * `<details>` is this app's most-used interaction — 70 of them — and
 * `DisclosureCaret` rotated over 200 ms while the thing it pointed at landed in
 * a single frame: the affordance animated, the payload not (issue #831).
 *
 * These read the stylesheet rather than a browser because the two decisions
 * worth pinning are decisions *about the CSS*: which properties move, and
 * whether the reduced-motion switch reaches a pseudo-element it does not name.
 * `e2e` drives the real thing.
 */
const CSS = readFileSync(path.join(import.meta.dirname, "globals.css"), "utf8");

const rule = (selector: string) => {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, `${selector} is in globals.css`).toBeGreaterThan(-1);
  return CSS.slice(start, CSS.indexOf("}", start));
};

describe("the disclosure body's motion", () => {
  /**
   * Principle 5 says "transform/opacity only", so the height is deliberately
   * *not* interpolated — that is layout, it costs a reflow per frame on every
   * one of the seventy, and it needs `overflow: hidden` on the content, which
   * would clip the roll call's controls and every menu that opens inside a
   * disclosure.
   */
  it("moves opacity and a translate, never a layout property", () => {
    const shut = rule("details::details-content");
    expect(shut).toContain("opacity: 0");
    expect(shut).toContain("translate: 0 -0.25rem");
    for (const layout of ["block-size", "height", "interpolate-size", "overflow"]) {
      expect(shut, `${layout} is layout, not transform/opacity`).not.toContain(layout);
    }
  });

  /** Without it the closing half cannot run: the content is `content-visibility: hidden` when shut. */
  it("keeps the content visible long enough to fade out", () => {
    expect(rule("details::details-content")).toContain("content-visibility 200ms allow-discrete");
  });

  it("arrives on the arrival curve and leaves on the exit one", () => {
    expect(rule("details[open]::details-content")).toContain(
      "transition-timing-function: var(--ease-out-soft)",
    );
    // The closed-state rule carries the exit curve, because that is the
    // direction it describes.
    expect(rule("details::details-content")).toContain("var(--ease-in-soft)");
  });

  /**
   * `*, *::before, *::after` does not reach `::details-content` — it is not one
   * of the two pseudo-elements the universal selector names. Without an
   * explicit entry every disclosure would keep its fade for a reader who asked
   * for reduced motion.
   */
  it("is reached by the reduced-motion kill-switch, which does not name it otherwise", () => {
    const start = CSS.indexOf("@media (prefers-reduced-motion: reduce) {");
    // To the media query's own closing brace — the first `}` in column one
    // after it, since every rule inside is indented.
    const block = CSS.slice(start, CSS.indexOf("\n}", start));
    expect(block).toContain("details::details-content,");
    expect(block).toContain("details[open]::details-content");
  });
});
