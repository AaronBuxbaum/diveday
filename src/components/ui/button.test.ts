import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type ButtonSize, buttonClass } from "./button";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SIZES = ["sm", "md", "lg", "cta", "boat", "icon"] as const satisfies readonly ButtonSize[];

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

  describe("busy", () => {
    // The two disabled meanings are one property spelled two ways, never both:
    // two `disabled:cursor-*` utilities in one class list resolve by stylesheet
    // order rather than by the order they were written, so a caller appending
    // the wait cursor through `className` gets whichever Tailwind emitted last.
    // That is the whole reason this is an option instead of a class string —
    // four hand-rolled boat targets each carried their own copy.
    it("says the disabled state is in-flight, not unavailable", () => {
      const busy = buttonClass({ busy: true });
      expect(busy).toContain("disabled:cursor-wait");
      expect(busy).not.toContain("disabled:cursor-not-allowed");
    });

    it("defaults to unavailable", () => {
      const idle = buttonClass();
      expect(idle).toContain("disabled:cursor-not-allowed");
      expect(idle).not.toContain("disabled:cursor-wait");
    });

    it("never emits both opacities", () => {
      for (const busy of [false, true]) {
        const classes = buttonClass({ busy });
        const opacities = classes
          .split(" ")
          .filter((token) => token.startsWith("disabled:opacity-"));
        expect(opacities, `busy=${busy}`).toHaveLength(1);
      }
    });
  });

  describe("icon", () => {
    it("is a square target: a fixed width against the base's height floor", () => {
      // `w-11` + `min-h-11` rather than `size-11` — a fixed height would clip a
      // glyph whose line box is taller than 44px, where a floor grows with it.
      const classes = buttonClass({ size: "icon", variant: "ghost" });
      expect(classes).toContain("w-11");
      expect(classes).toContain("min-h-11");
      expect(classes).not.toContain("size-11");
    });

    it("carries no horizontal padding to fight the fixed width", () => {
      expect(horizontalPadding(buttonClass({ size: "icon" }))).toEqual(["px-0"]);
    });
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

  /**
   * The colour half of the same trap, policed across the tree rather than in
   * one assertion — because the failure is *silent*. Thirty-one call sites had
   * written `className: "text-foreground"` against the `secondary` variant's
   * own `text-primary`, and every one of them rendered primary: two utilities
   * for one property resolve by stylesheet order, and Tailwind v4 emits colour
   * utilities alphabetically by token name, so `.text-primary` lands after both
   * `.text-foreground` and `.text-muted`. Nothing errors, nothing looks broken,
   * and the class string reads as though someone already fixed it.
   *
   * `check-tokens.mjs` polices raw hex the same way; this is the equivalent for
   * "a colour a button will never wear". The answer to a button that needs a
   * label colour no variant offers is a **new variant**, the same answer
   * `flush` gave for padding — never Tailwind's `!` suffix, which papers over
   * one instance and leaves the next override just as inert.
   */
  describe("no call site passes a colour through className", () => {
    /**
     * Every `text-<token>` that names a colour, read off the `@theme` block in
     * `globals.css` rather than hard-coded here — so a token added tomorrow is
     * covered without anyone remembering this file. Sizes (`text-sm`),
     * alignment (`text-center`) and wrapping (`text-balance`) are not in that
     * block and are therefore not matched.
     */
    const colourTokens = () => {
      const css = readFileSync(join(SRC_DIR, "app", "globals.css"), "utf8");
      const theme = css.slice(css.indexOf("@theme inline"));
      return new Set(
        [...theme.matchAll(/--color-([a-z0-9-]+):/g)].map((match) => `text-${match[1]}`),
      );
    };

    const sourceFiles = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
      });

    /**
     * The text of every `buttonClass(...)` argument list in a file, found by
     * balancing parentheses rather than by a regex — the argument may be a
     * ternary, a spread, or a nested call, and a regex that stops at the first
     * `)` reads none of those.
     */
    function buttonClassArgs(source: string): string[] {
      const found: string[] = [];
      const call = "buttonClass(";
      for (let at = source.indexOf(call); at !== -1; at = source.indexOf(call, at + 1)) {
        let cursor = at + call.length;
        let depth = 1;
        while (cursor < source.length && depth > 0) {
          if (source[cursor] === "(") depth += 1;
          else if (source[cursor] === ")") depth -= 1;
          cursor += 1;
        }
        found.push(source.slice(at + call.length, cursor - 1));
      }
      return found;
    }

    it("hands no `text-<color>` token to buttonClass", () => {
      const colours = colourTokens();
      expect(colours.size, "globals.css @theme colours were not found").toBeGreaterThan(5);

      const offenders: string[] = [];
      for (const file of sourceFiles(SRC_DIR)) {
        const source = readFileSync(file, "utf8");
        if (!source.includes("buttonClass(")) continue;
        for (const args of buttonClassArgs(source)) {
          for (const token of args.match(/text-[a-z0-9-]+/g) ?? []) {
            if (colours.has(token)) offenders.push(`${relative(SRC_DIR, file)}: ${token}`);
          }
        }
      }

      // Listed, not counted: the message has to name the file, because the
      // whole point is that nothing on screen will.
      expect(offenders).toEqual([]);
    });
  });
});
