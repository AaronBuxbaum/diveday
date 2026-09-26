import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type ButtonSize, type ButtonVariant, buttonClass } from "./button";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SIZES = ["sm", "md", "boat", "icon", "icon-sm"] as const satisfies readonly ButtonSize[];

/**
 * Every variant, as a record keyed by the type so that a variant added to
 * `button.ts` fails the typecheck here until it is listed, and every sweep
 * below reaches it.
 */
const EVERY_VARIANT: Record<ButtonVariant, true> = {
  primary: true,
  secondary: true,
  outline: true,
  ghost: true,
  danger: true,
  "danger-ghost": true,
  "danger-solid": true,
  link: true,
  sky: true,
  bare: true,
};
const VARIANTS = Object.keys(EVERY_VARIANT) as ButtonVariant[];

/** The sizes that carry a horizontal padding for `flush` to act on. */
const PADDED_SIZES = ["sm", "md", "boat"] as const satisfies readonly ButtonSize[];

/** The variants that paint nothing of their own around their label, hover included. */
const PAINTS_NOTHING = ["link", "bare"] as const satisfies readonly ButtonVariant[];

/** The variants that paint a fill around their label on hover, and only then. */
const HOVER_FILL_VARIANTS = ["ghost", "danger-ghost"] as const satisfies readonly ButtonVariant[];

/** The variants painted at rest: a filled or bordered box. */
const PAINTED_AT_REST = [
  "primary",
  "secondary",
  "outline",
  "danger",
  "danger-solid",
  "sky",
] as const satisfies readonly ButtonVariant[];

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

  it("centres a wrapped label's lines, not only the box", () => {
    // `justify-center` centres the label's box, and a label that wraps fills
    // the box, so its lines fell back to start alignment: "One flat $99 per
    // location / month. See the full list" on /about at 390 started 17px
    // inside the left border and ended 43px inside the right (pixel probe,
    // K-84). `text-center` sorts before `text-start` and `text-left`, so a
    // row-shaped button that passes one of those still aligns to the start.
    for (const variant of VARIANTS) {
      expect(buttonClass({ variant }).split(" "), variant).toContain("text-center");
    }
  });

  it("draws every filled or bordered box with the same 1px border, so a toggle keeps its label still", () => {
    // `primary` and `danger-solid` had no border and `secondary` had one, so a
    // filled button was 2px narrower than a bordered one with the same label
    // (settings-calendar: 180px against 182px), and a toggle that swaps the
    // two moved its label and its box 1px sideways (the offline counter's
    // "Check in" / "Checked in", K-83). A transparent border keeps the box;
    // the fill paints under it, edge to edge.
    for (const variant of ["primary", "secondary", "outline", "danger", "danger-solid"] as const) {
      const tokens = buttonClass({ variant }).split(" ");
      expect(tokens, variant).toContain("border");
    }
    for (const variant of ["primary", "danger-solid"] as const) {
      expect(buttonClass({ variant }).split(" "), variant).toContain("border-transparent");
    }
  });

  describe("hover", () => {
    const hoverTokens = (classes: string) =>
      classes.split(" ").filter((token) => /(^|:)hover:/.test(token));

    it("paints nothing on a disabled button: every hover is `not-disabled:hover:`", () => {
      // Tailwind v4's `hover:` still matches a disabled button, and `DISABLED`
      // only dims it, so a disabled chip inside `RepeatFields`'s `<fieldset
      // disabled>` took the sunken fill under the pointer (the state atlas,
      // K-137). Not `enabled:`: an `<a>` styled by `buttonClass` is never
      // `:enabled` and would lose its hover altogether.
      for (const variant of VARIANTS) {
        const tokens = hoverTokens(buttonClass({ variant }));
        for (const token of tokens) {
          expect(token, variant).toMatch(/^not-disabled:hover:/);
        }
      }
    });

    it("steps the fill down from whatever ground the button stands on", () => {
      // `secondary` and `ghost` hovered to `bg-surface-sunken`, which is the
      // ground of every sunken card and board — on one, the hover painted the
      // card's own colour (#ececf1 on #ececf1, delta 0; the recap plan and the
      // schedule builder, K-123). A wash of the ink colour is a step darker than
      // any ground in light, a step lighter in dark.
      for (const variant of ["secondary", "ghost"] as const) {
        const tokens = hoverTokens(buttonClass({ variant }));
        expect(
          tokens.filter((token) => token.endsWith("bg-surface-sunken")),
          variant,
        ).toEqual([]);
        expect(tokens, variant).toContain("not-disabled:hover:bg-foreground/8");
      }
    });
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
      expect(classes).toContain("w-12");
      expect(classes).toContain("min-h-12");
      expect(classes).not.toContain("size-12");
    });

    it("carries no horizontal padding to fight the fixed width", () => {
      expect(horizontalPadding(buttonClass({ size: "icon" }))).toEqual(["px-0"]);
    });
  });

  describe("outdent", () => {
    // A quiet `sm` button is a 44px box around a 20px line: 12px of box under
    // its word that nobody sees. Last in a padded card, that box adds to the
    // padding: the team card measured 21px above the name and 33px under
    // "Disable", the safety checklist at 390 16px against 28px (pixel probe,
    // K-43). `outdent` sinks the unseen half into the padding and keeps the
    // target whole.
    const tokens = (classes: string) => classes.split(" ");

    it("pulls the box's end up by the half of it nobody sees, at every width or below sm", () => {
      const always = tokens(
        buttonClass({ variant: "danger-ghost", size: "sm", outdent: "block-end" }),
      );
      expect(always).toContain("-mb-3");
      // An inline-flex button's margin box sits on its line's baseline, and the
      // line's own strut would keep a pixel of the height the margin gave
      // back; aligned to the line's bottom, the line is exactly the margin box.
      expect(always).toContain("align-bottom");
      expect(always).toContain("min-h-11");

      const phone = tokens(
        buttonClass({ variant: "ghost", size: "icon-sm", outdent: "block-end-phone" }),
      );
      expect(phone).toContain("max-sm:-mb-3");
      expect(phone).toContain("max-sm:align-bottom");
      expect(phone).not.toContain("-mb-3");
    });

    it("measures the unseen half from the size: 12px on sm and md, 16px on the 56px dock target", () => {
      for (const size of ["sm", "md", "icon", "icon-sm"] as const) {
        expect(
          tokens(buttonClass({ variant: "ghost", size, outdent: "block-end" })),
          size,
        ).toContain("-mb-3");
      }
      expect(
        tokens(buttonClass({ variant: "ghost", size: "boat", outdent: "block-end" })),
      ).toContain("-mb-4");
    });

    it("refuses outdent on a variant painted at rest, whose box is what the eye measures", () => {
      // @ts-expect-error — a bordered box's end is its border, not its word.
      buttonClass({ variant: "secondary", outdent: "block-end" });
      const forced = "block-end" as unknown as undefined;
      for (const variant of PAINTED_AT_REST) {
        expect(buttonClass({ variant, size: "sm", outdent: forced }), variant).toBe(
          buttonClass({ variant, size: "sm" }),
        );
      }
      // A control that swaps between a box and a ghost (the team card's
      // Enable / Disable) passes it always; only the ghost takes it.
      const swap = (disabled: boolean) =>
        buttonClass({
          variant: disabled ? "secondary" : "danger-ghost",
          size: "sm",
          outdent: "block-end",
        });
      expect(tokens(swap(false))).toContain("-mb-3");
      expect(tokens(swap(true))).not.toContain("-mb-3");
    });
  });

  describe("outline", () => {
    it("is secondary with the border that holds 3:1 against the ground, for the public pages", () => {
      // The public pages had each chosen `border-border-strong` by hand; the
      // staff `secondary` keeps its hairline. One decision, in one place.
      const outline = buttonClass({ variant: "outline" }).split(" ");
      expect(outline).toContain("border-border-strong");
      expect(outline).not.toContain("border-border");
      expect(outline).toContain("bg-surface");
      expect(outline).toContain("text-foreground");
      const secondary = buttonClass({ variant: "secondary" }).split(" ");
      expect(secondary).toContain("border-border");
      expect(secondary).not.toContain("border-border-strong");
    });
  });

  describe("shape", () => {
    const radii = (classes: string) =>
      classes.split(" ").filter((token) => /^(?:[\w-]+:)*rounded(?:-|$)/.test(token));

    it("draws the control rung by default, and exactly one radius", () => {
      for (const size of SIZES) {
        expect(radii(buttonClass({ size })), size).toEqual(["rounded-lg"]);
      }
    });

    it("draws a pill when asked, instead of the rung rather than beside it", () => {
      // `rounded-full` through `className` lost to the base's `rounded-lg`:
      // Tailwind emits `.rounded-full` first, so the later rule wins whatever
      // the attribute says. The weekday chips and the public trip's floating
      // Book asked for a pill and drew 12px corners (pixel probe, K-44).
      expect(radii(buttonClass({ shape: "pill" }))).toEqual(["rounded-full"]);
      expect(radii(buttonClass({ variant: "ghost", size: "sm", shape: "pill" }))).toEqual([
        "rounded-full",
      ]);
    });

    it("draws the roll-call mark as the circle it is documented to be", () => {
      // The mark's focus ring measured a rounded square (17px outer radius on
      // the 56px box) because its `rounded-full` never applied.
      expect(radii(buttonClass({ variant: "bare", size: "mark" }))).toEqual(["rounded-full"]);
    });
  });

  describe("icon-sm", () => {
    it("is a 44px square, level with the `sm` buttons beside it", () => {
      // A glyph-only `sm` was `px-3` around a 16px glyph: 40 wide against a
      // 44px floor, on every review row's "more", the week board's departure
      // menu and the safety checklist's arrows (pixel probe, K-41). `icon` is
      // 48 and would stand 4px above its `sm` neighbours.
      const tokens = buttonClass({ variant: "ghost", size: "icon-sm" }).split(" ");
      expect(tokens).toContain("w-11");
      expect(tokens).toContain("min-h-11");
      expect(tokens).not.toContain("min-h-12");
      expect(tokens).toContain("text-sm");
      expect(horizontalPadding(tokens.join(" "))).toEqual(["px-0"]);
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

    it("drops a link's and a bare button's padding whole: neither paints a fill for the words to sit against", () => {
      // The premise that lets them be truly padless: a link's hover is an
      // underline, and `bare` paints nothing of its own at all.
      for (const variant of PAINTS_NOTHING) {
        const tokens = buttonClass({ variant, flush: true }).split(" ");
        expect(
          tokens.filter((token) => /^(?:[\w-]+:)*bg-/.test(token)),
          variant,
        ).toEqual([]);
        expect(
          tokens.filter((token) => /^(?:[\w-]+:)*-m[xse]-/.test(token)),
          variant,
        ).toEqual([]);
        expect(horizontalPadding(tokens.join(" ")), variant).toEqual(["px-0"]);
      }
    });

    it("keeps 8px around a ghost's label, outdented by the same 8px, because its hover paints the box", () => {
      // The pixel probe (2026-09-25): "Delete Morgan Vale" and a gear unit's
      // "Delete" are `danger-ghost` + `flush`, and their hover tint measured
      // 0px either side of the words — `px-0` had taken the room along with
      // the indent. The label still has to line up with the text above it,
      // which is what `flush` is for, so the room goes back on as padding and
      // comes off again as an equal negative margin: the words sit where a
      // padless label would, and the tint reaches 8px past them. 8px rather
      // than the size's own padding, so the tint and the 5px focus ring stay
      // inside a phone's 16px gutter.
      for (const variant of HOVER_FILL_VARIANTS) {
        for (const size of PADDED_SIZES) {
          const classes = buttonClass({ variant, size, flush: true });
          expect(horizontalPadding(classes), `${variant}/${size}`).toEqual(["px-2"]);
          expect(classes.split(" "), `${variant}/${size}`).toContain("-mx-2");
        }
      }
    });

    it("refuses flush on a variant painted at rest, and leaves its box as the size draws it", () => {
      // A filled or bordered box lines up by its box, not by its label
      // (docs/design/pixel-craft.md, class 3): half its padding and an 8px
      // overhang would be a box drawn two ways. The type says so; at runtime
      // the option changes nothing.
      // @ts-expect-error — `flush` is `false` only on a painted variant.
      buttonClass({ variant: "primary", flush: true });
      // @ts-expect-error — and on the default variant, which is `primary`.
      buttonClass({ flush: true });
      // What a caller that got past the type would pass.
      const forced = true as boolean as false;
      for (const variant of PAINTED_AT_REST) {
        for (const size of PADDED_SIZES) {
          const flushed = buttonClass({ variant, size, flush: forced });
          expect(flushed, `${variant}/${size}`).toBe(buttonClass({ variant, size }));
        }
      }
    });

    it("leaves a size with no horizontal padding exactly as it was", () => {
      // An icon square has no padding to drop and no text to line up: `flush`
      // on it must not shove the square 8px out of place.
      for (const size of ["icon", "icon-sm", "mark"] as const) {
        for (const variant of ["link", "danger-ghost"] as const) {
          expect(buttonClass({ variant, size, flush: true }), `${variant}/${size}`).toBe(
            buttonClass({ variant, size }),
          );
        }
      }
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
    const colourTokens = (prefix = "text") => {
      const css = readFileSync(join(SRC_DIR, "app", "globals.css"), "utf8");
      const theme = css.slice(css.indexOf("@theme inline"));
      return new Set(
        [...theme.matchAll(/--color-([a-z0-9-]+):/g)].map((match) => `${prefix}-${match[1]}`),
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

    it("hands no border or fill colour to buttonClass: the box is the variant's", () => {
      // Eight public call sites wrote `border-border-strong` over `secondary`'s
      // own `border-border` while the marketing header's did not, so the
      // header's "Try the demo" and the hero's "Get set up" were one button
      // drawn with two borders on the same screen (#e3e3e8 against #86868b,
      // K-38). A border a page needs is a variant (`outline`), decided once.
      const colours = new Set([...colourTokens("border"), ...colourTokens("bg")]);
      const offenders: string[] = [];
      for (const file of sourceFiles(SRC_DIR)) {
        const source = readFileSync(file, "utf8");
        if (!source.includes("buttonClass(")) continue;
        for (const args of buttonClassArgs(source)) {
          for (const token of args.match(/(?<![\w-])(?:[\w-]+:)*(?:border|bg)-[a-z0-9-]+/g) ?? []) {
            if (colours.has(token.replace(/^(?:[\w-]+:)+/, ""))) {
              offenders.push(`${relative(SRC_DIR, file)}: ${token}`);
            }
          }
        }
      }
      expect(offenders).toEqual([]);
    });

    it("hands no font weight to buttonClass: the weight is the size's", () => {
      // The marketing header's CTA passed `font-semibold` over `md`'s
      // `font-medium` and rendered at 600 beside the hero's 500 (K-38). Two
      // weights resolve by stylesheet order, so this one won by luck, and a
      // size is the one place a button's type is decided.
      const offenders: string[] = [];
      for (const file of sourceFiles(SRC_DIR)) {
        const source = readFileSync(file, "utf8");
        if (!source.includes("buttonClass(")) continue;
        for (const args of buttonClassArgs(source)) {
          for (const token of args.match(
            /(?<![\w-])(?:[\w-]+:)*font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)(?![\w-])/g,
          ) ?? []) {
            offenders.push(`${relative(SRC_DIR, file)}: ${token}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    });

    it("hands no negative inline margin to buttonClass: the sideways outdent is `flush`", () => {
      // A ghost's invisible padding put its label 12px inside the column it
      // started or ended — seasons' Delete at x 478 against the fields' 466 —
      // and the answer at call sites was a hand cancel (`-ml-3`, `-mr-4`,
      // `-ms-2`), which only ever cancelled one side, clipped rings in
      // `overflow-hidden` cards, and left the next site to find its own
      // number (pixel probe, K-06). `flush` is the one sideways outdent: it knows the
      // size's padding and keeps 8px of room for a hover fill.
      //
      // This reads what is written in the call. A class that reaches
      // `buttonClass` through a prop is outside it — the week board's
      // `RowActions` takes `-me-2` that way, on an `icon-sm` square, which has
      // no label to line up and which `flush` leaves alone.
      const offenders: string[] = [];
      for (const file of sourceFiles(SRC_DIR)) {
        const source = readFileSync(file, "utf8");
        if (!source.includes("buttonClass(")) continue;
        for (const args of buttonClassArgs(source)) {
          for (const token of args.match(/(?<![\w-])(?:[\w-]+:)*-m[xlrse]-[\w.[\]]+/g) ?? []) {
            offenders.push(`${relative(SRC_DIR, file)}: ${token}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    });

    /**
     * Every element whose own `className` literal pulls it sideways with a
     * negative inline margin and which wraps a quiet button — the hand cancel
     * of the test above, one level up. A margin the same element hands back as
     * padding (`-mx-2 px-2`, a fill's room) moves no word and is not one.
     *
     * Read by indentation, which Biome keeps honest: an element runs from its
     * opening `<tag` to the first `</tag>` at the same indent. A quiet button
     * is a `buttonClass({ variant: "ghost" | "danger-ghost" … })` written
     * inside it; one drawn by a component (`Copyable`) is not seen.
     */
    function bleedingWrappers(source: string): string[] {
      const lines = source.split("\n");
      const found: string[] = [];
      const negativeInline = /(?<![\w-])((?:[\w-]+:)*)-m([xlrse])-([\w.[\]]+)/g;
      for (const [at, line] of lines.entries()) {
        for (const literal of line.match(/className=(?:"[^"]*"|\{`[^`]*`\})/g) ?? []) {
          const classes = literal.split(/[\s"`{}=]+/);
          for (const [token, prefix, side, size] of literal.matchAll(negativeInline)) {
            if (classes.includes(`${prefix}p${side}-${size}`)) continue;
            let open = at;
            while (open >= 0 && !/^\s*<[A-Za-z]/.test(lines[open])) open -= 1;
            const [, indent, tag] = lines[open]?.match(/^(\s*)<([\w.]+)/) ?? [];
            if (!tag) continue;
            let end = at;
            while (end < lines.length && !/[^=]>\s*$|^\s*>\s*$/.test(lines[end])) end += 1;
            if (/\/>\s*$/.test(lines[end] ?? "")) continue;
            const close = lines.findIndex((l, i) => i > end && l.startsWith(`${indent}</${tag}>`));
            if (close < 0) continue;
            const body = lines.slice(open, close).join("\n");
            if (/buttonClass\(\{[^}]*variant: "(?:danger-)?ghost"/.test(body)) {
              found.push(`${token} on line ${at + 1}`);
            }
          }
        }
      }
      return found;
    }

    it("bleeds no wrapper of a quiet button sideways: the row's first control goes `flush`", () => {
      // The roster's foot row was `-mx-3` around a link and a danger-ghost, so
      // the pair sat on the text column and the first control stood 4px from
      // the card's clip, where its ring needed drawing inside (K-06). The
      // shape as it was, so the sweep is known to see it:
      const roster = [
        '        <div className="mt-4 border-t border-border pt-4">',
        '          <div className="-mx-3 flex flex-wrap items-center gap-x-1 gap-y-2">',
        "            <form action={removeBookingAction}>",
        "              <InlineConfirm",
        "                triggerClassName={buttonClass({",
        '                  variant: "danger-ghost",',
        '                  size: "sm",',
        "                })}",
        "              />",
        "            </form>",
        "          </div>",
        "        </div>",
      ].join("\n");
      expect(bleedingWrappers(roster)).toEqual(["-mx-3 on line 2"]);
      // A fill's room is handed straight back and moves nothing.
      expect(bleedingWrappers(roster.replace("-mx-3 ", "-mx-2 px-2 "))).toEqual([]);

      const offenders: string[] = [];
      for (const file of sourceFiles(SRC_DIR)) {
        const source = readFileSync(file, "utf8");
        if (!source.includes("buttonClass(")) continue;
        for (const hit of bleedingWrappers(source)) {
          offenders.push(`${relative(SRC_DIR, file)}: ${hit}`);
        }
      }
      expect(offenders).toEqual([]);
    });

    it("hands no radius to buttonClass: the corner is `shape`'s", () => {
      // Two radius utilities resolve by stylesheet order, and `.rounded-full`
      // is emitted before `.rounded-lg`, so a pill asked for through
      // `className` drew the rung's 12px corners (K-44).
      const offenders: string[] = [];
      for (const file of sourceFiles(SRC_DIR)) {
        const source = readFileSync(file, "utf8");
        if (!source.includes("buttonClass(")) continue;
        for (const args of buttonClassArgs(source)) {
          for (const token of args.match(/(?<![\w-])(?:[\w-]+:)*rounded(?:-[\w[\]/.-]+)?/g) ?? []) {
            offenders.push(`${relative(SRC_DIR, file)}: ${token}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    });

    it("hands no bare `hover:` to buttonClass, which would paint on a disabled button", () => {
      // The variants guard their hovers with `not-disabled:`; a caller's own
      // `hover:` would not be, and would bring back the fill on a disabled
      // control that K-137 took away.
      const offenders: string[] = [];
      for (const file of sourceFiles(SRC_DIR)) {
        const source = readFileSync(file, "utf8");
        if (!source.includes("buttonClass(")) continue;
        for (const args of buttonClassArgs(source)) {
          for (const token of args.match(/(?<![\w:-])hover:[^\s"'`]+/g) ?? []) {
            offenders.push(`${relative(SRC_DIR, file)}: ${token}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    });
  });
});
