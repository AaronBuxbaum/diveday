import { describe, expect, it } from "vitest";
import { type ButtonSize, buttonClass } from "./button";

const SIZES = ["sm", "md", "lg", "cta", "boat"] as const satisfies readonly ButtonSize[];

/**
 * Every horizontal-padding utility in a class list, variant prefixes included —
 * `px-4`, `sm:px-6`, `dark:lg:px-8`, `-px-2`. Deliberately *not* the
 * `/\bpx-[^\s]+/` this file's implementation used to strip with: that one
 * matches the `px-6` inside `sm:px-6` and leaves the `sm:` behind, which is the
 * bug these tests exist to keep out.
 */
const horizontalPadding = (classes: string) =>
  classes.split(/\s+/).filter((token) => /^(?:[\w.-]+:)*-?px-/.test(token));

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

  it("emits no empty or malformed class tokens", () => {
    // A dangling variant prefix (`sm:`) is not a class, and a double space is
    // how one gets built by string surgery. Cheap to assert, and it is the
    // shape the previous flush implementation produced.
    for (const size of SIZES) {
      for (const flush of [false, true]) {
        const classes = buttonClass({ variant: "link", size, flush });
        expect(classes, `${size}/${flush}`).not.toMatch(/\s{2,}/);
        expect(classes.split(" ").filter((token) => token === "" || token.endsWith(":"))).toEqual(
          [],
        );
      }
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

    it("leaves exactly one horizontal padding, at every size", () => {
      // A size change must not silently reintroduce the indent — the failure
      // the wrapper-div workaround this replaced was exposed to.
      for (const size of SIZES) {
        expect(
          horizontalPadding(buttonClass({ variant: "link", size, flush: true })),
          size,
        ).toEqual(["px-0"]);
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

    it("removes a size's whole horizontal padding, responsive variants included", () => {
      // The structural pin behind the case Sourcery raised on #513. No size
      // ships a responsive padding today, so this asserts the invariant that
      // makes one safe when it does: a size's horizontal padding lives in one
      // field, and every `px-*` a button renders comes from that field. Add
      // `sm:px-6` to a size's `x` and flush still drops it at every
      // breakpoint, because nothing parses the class string to find it.
      //
      // If this fails, someone has written a `px-*` into a size's `rest` (or
      // into `base`/`variants`), and `flush` will now leave that one behind —
      // which is the indent the option exists to remove.
      for (const size of SIZES) {
        const padded = horizontalPadding(buttonClass({ variant: "link", size }));
        const flushed = horizontalPadding(buttonClass({ variant: "link", size, flush: true }));

        expect(padded, `${size} declares its horizontal padding`).not.toEqual([]);
        expect(flushed, `${size} flushed`).toEqual(["px-0"]);
        for (const token of padded) {
          if (token !== "px-0") {
            expect(
              buttonClass({ variant: "link", size, flush: true }),
              `${size} still carries ${token} when flushed`,
            ).not.toContain(token);
          }
        }
      }
    });
  });
});
