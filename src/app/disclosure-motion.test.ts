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

  /**
   * **An open body comes to rest as no layer of its own.** Any `translate`
   * but `none` makes an element a stacking context, and `0 0` is not `none`:
   * every open disclosure's body was one, painted after the normal-flow
   * content around it, its summary's outset focus ring included. Wherever a
   * body starts flush with a filled card under its summary, the card covered
   * the ring's bottom arm — the atlas caught the diver record's groups with a
   * three-sided ring. `none` interpolates as the identity, so the rise still
   * runs; it just stops being a layer when it lands.
   */
  it("lands the open body on no translate at all, so it stops being a layer", () => {
    const open = rule("details[open]::details-content");
    expect(open).toContain("translate: none");
    expect(open).not.toMatch(/translate: 0 0/);
  });

  /** Without it the closing half cannot run: the content is `content-visibility: hidden` when shut. */
  it("keeps the content visible long enough to fade out", () => {
    expect(rule("details::details-content")).toContain(
      "content-visibility var(--motion-base) allow-discrete",
    );
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
   * The diver record's file groups are doors at every width now, so nothing
   * force-opens a closed `<details>` at a breakpoint. The rule that did —
   * `.diver-file-group:not(.diver-file-group--desktop-collapsible)` inside a
   * `min-width: 40rem` query — went with the legacy branch it existed for.
   */
  it("never re-opens a closed disclosure at a breakpoint", () => {
    expect(CSS).not.toContain("content-visibility: visible !important");
    expect(CSS).not.toContain(".diver-file-group");
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
