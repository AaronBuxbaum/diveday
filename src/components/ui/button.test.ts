import { describe, expect, it } from "vitest";
import { buttonClass } from "./button";

describe("buttonClass", () => {
  it("keeps the touch target on every variant", () => {
    // The `min-h-11` floor and the inline-flex centering are the reason this
    // helper exists rather than hand-written class strings: a plain block box
    // leaves the label at the top of the taller target instead of centered in
    // it. See docs/design/forms-and-controls.md.
    for (const variant of ["primary", "secondary", "ghost", "danger", "link"] as const) {
      const classes = buttonClass({ variant });
      expect(classes, variant).toContain("min-h-11");
      expect(classes, variant).toContain("items-center");
    }
  });

  describe("flush", () => {
    it("drops the size's horizontal padding rather than appending to it", () => {
      // The whole point: `className: "px-0"` cannot do this. Two utilities for
      // one property resolve by stylesheet order, and Tailwind emits `px-0`
      // before `px-4`, so a `className` override loses to the size and the
      // label renders indented from the text it is meant to line up with.
      const flushed = buttonClass({ variant: "link", flush: true });
      expect(flushed).toContain("px-0");
      expect(flushed).not.toMatch(/\bpx-4\b/);
    });

    it("drops the horizontal padding of whichever size is asked for", () => {
      // A size change must not silently reintroduce the indent — the failure
      // the wrapper-div workaround this replaced was exposed to.
      for (const size of ["sm", "md", "lg", "cta", "boat"] as const) {
        const flushed = buttonClass({ variant: "link", size, flush: true });
        expect(flushed.match(/\bpx-[^\s]+/g), size).toEqual(["px-0"]);
      }
    });

    it("keeps the vertical padding and the touch target", () => {
      // Only the horizontal half misaligns text; the vertical half is the
      // touch target and stays.
      const flushed = buttonClass({ variant: "link", flush: true });
      expect(flushed).toContain("py-2.5");
      expect(flushed).toContain("min-h-11");
    });

    it("is off by default", () => {
      expect(buttonClass({ variant: "link" })).toContain("px-4");
    });
  });
});
