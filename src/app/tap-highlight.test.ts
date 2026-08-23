import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **The square behind a rounded control, and why no other check can see it.**
 *
 * A phone paints its own highlight under the element a finger is on, over the
 * *border box* — `border-radius` is ignored — so a `rounded-lg` input flashes
 * a hard-edged grey rectangle behind itself for the length of a tap. The app
 * turns that off, and for a long time turned it off for `button, a, summary`
 * and nothing else, which left every text input in the product wearing one
 * (issue #782, reported against the divers roster's search box).
 *
 * Nothing else in the suite can catch it. The highlight exists only while a
 * pointer is down, and Playwright's project is `devices["Desktop Chrome"]`,
 * which never taps — so a visual capture of a focused input is identical
 * either way, and claiming one covers this would be worse than no test at all.
 * What is checkable is the stylesheet, which is what this reads.
 */
const CSS = readFileSync(path.join(import.meta.dirname, "globals.css"), "utf8");

/** Declaration blocks whose body sets the tap highlight away, selectors intact. */
const tapHighlightSelectors = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([, , body]) => /-webkit-tap-highlight-color:\s*transparent/.test(body ?? ""))
  .map(([, selector]) => (selector ?? "").replace(/\/\*[\s\S]*?\*\//g, ""));

describe("the tap highlight reset", () => {
  it("covers every control a finger can land on, not only the ones that look tappable", () => {
    expect(tapHighlightSelectors, "a rule turns the UA tap highlight off").not.toHaveLength(0);
    const covered = tapHighlightSelectors
      .join(",")
      .split(",")
      .map((one) => one.trim())
      .filter(Boolean);
    // The same list as the `:focus-visible` rule above it: a control that can
    // take focus can take a tap.
    for (const control of ["a", "button", "input", "select", "textarea", "summary"]) {
      expect(covered, control).toContain(control);
    }
  });
});
