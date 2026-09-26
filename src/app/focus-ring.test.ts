import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  baseLayerRules,
  declarations,
  readGlobalsCss,
  topLevelBlocks,
  unlayeredRules,
} from "@/test/stylesheet";

/**
 * **One focus ring, and a cascade that lets a component choose where it sits.**
 *
 * The global `:focus-visible` rule sat in `globals.css` outside any `@layer`,
 * and Tailwind v4 emits every utility inside `@layer utilities` — so the
 * unlayered rule beat every component's own ring, whatever its specificity. A
 * row that asked for an inset ring (`outline-offset-[-2px]`) rendered the
 * global 3px ring at +2px instead, and the `overflow-hidden` card it sat in cut
 * it away: the pixel probe measured the rendered outline at 3px / +2px on the
 * trip's About summary and the offline manifest's rows, and counted 1,700
 * clipped rings in 32 clusters across 90 captures. Ten components drew a 2px
 * ring of their own on elements the global rule never reaches (a label standing
 * in for an `sr-only` input, a switch's track), so one ring was drawn two ways.
 *
 * This file is the half of the check that runs without a browser. It reads the
 * stylesheet and the class strings, so it can say what each element asks for
 * and never what renders. The rendered ring is the pixel probe's to measure:
 * it forces `:focus-visible` at 1280px on every capture, and the command
 * palette's baseline holds its focused field. docs/design/pixel-craft.md reads
 * geometry from the rendered box, never from a class string. Where a component
 * renders in jsdom, its own test pins which element carries the ring.
 */
const CSS = readGlobalsCss();

const layerBase = baseLayerRules(CSS);

const utility = (name: string) =>
  topLevelBlocks(CSS).find((block) => block.prelude === `@utility ${name}`)?.body ?? "";

const RING = { outline: "3px solid var(--focus-ring)", "outline-offset": "2px" };

describe("the global focus ring", () => {
  const globalRule = layerBase.find((rule) => rule.prelude.includes(":focus-visible"));

  it("lives in @layer base, so a component's own ring utility can win", () => {
    expect(globalRule, "a :focus-visible rule inside @layer base").toBeDefined();
    const stray = unlayeredRules(CSS).filter(
      (rule) => rule.prelude.includes(":focus") && /\boutline\b/.test(rule.body),
    );
    expect(
      stray.map((rule) => rule.prelude),
      "an unlayered focus outline beats every layered utility, whatever its specificity",
    ).toEqual([]);
  });

  it("reaches every control a keyboard lands on", () => {
    const selector = globalRule?.prelude ?? "";
    for (const control of ["a", "button", "input", "select", "textarea", "summary"]) {
      expect(selector, control).toMatch(new RegExp(`[(,\\s]${control}[,)\\s]`));
    }
  });

  it("is 3px of --focus-ring at a 2px offset", () => {
    expect(declarations(globalRule?.body ?? "")).toEqual(RING);
  });
});

describe("the ring utilities", () => {
  it("`focus-ring` is the global ring, for the stand-in a hidden control focuses through", () => {
    expect(declarations(utility("focus-ring"))).toEqual(RING);
  });

  it("`focus-ring-inset` is the same ring drawn wholly inside the box", () => {
    // -3px puts the outline's outer edge on the border box, so no
    // `overflow-hidden` ancestor flush with the element can cut any of it.
    expect(declarations(utility("focus-ring-inset"))).toEqual({
      ...RING,
      "outline-offset": "-3px",
    });
  });
});

const SRC = path.join(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** `has-[:focus-visible]:outline-2` → `["has-[:focus-visible]", "outline-2"]`: a colon in brackets stays put. */
function segments(token: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of token) {
    if (char === "[") depth++;
    if (char === "]") depth--;
    if (char === ":" && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

/**
 * `focus`, `focus-visible` and `focus-within`; their `peer-`, `group-` and
 * `in-` forms; `has-` in front of any of them (`has-focus-visible`,
 * `group-has-focus-visible/row`); and any bracketed variant that names a focus
 * pseudo-class (`has-[:focus-visible]`, `group-has-[:focus-within]`,
 * `[&:focus-visible]`).
 */
const FOCUS_VARIANT =
  /^(?:(?:peer|group|in)-)?(?:has-)?(?:focus(?:-visible|-within)?|\[.*:focus.*\])(?:\/[\w-]+)?$/;
/**
 * A width or an offset, the geometry the two utilities own, including the
 * negative offset (`-outline-offset-2`) an inset ring was once spelled with.
 * Colour is free.
 */
const RING_GEOMETRY = /^!?-?(?:outline|ring)(?:-(?:\d+|\[[^\]]*\]|offset-.+|inset))?!?$/;

function handDrawnRings(source: string): string[] {
  return source.split(/[\s"'`{}()$,]+/).filter((token) => {
    const parts = segments(token);
    if (parts.length < 2) return false;
    return (
      RING_GEOMETRY.test(parts.at(-1) ?? "") &&
      parts.slice(0, -1).some((variant) => FOCUS_VARIANT.test(variant))
    );
  });
}

describe("no component draws its own ring", () => {
  it("recognises every shape a hand-drawn ring has taken here", () => {
    expect(
      handDrawnRings(
        [
          "focus-visible:outline-2 focus-visible:outline-offset-[-2px]",
          "focus-within:outline-2 focus-within:outline-offset-2",
          "has-[:focus-visible]:outline-2 has-[:focus-visible]:ring-offset-2",
          "peer-focus-visible:ring-2 focus-visible:after:outline-2",
          "group-focus-visible/row:ring",
          "focus-visible:-outline-offset-2 has-focus-visible:outline-2",
          "group-has-[:focus-visible]:ring-2 group-has-focus-visible/row:outline-offset-1",
          "[&:focus-visible]:outline-2",
        ].join(" "),
      ),
    ).toEqual([
      "focus-visible:outline-2",
      "focus-visible:outline-offset-[-2px]",
      "focus-within:outline-2",
      "focus-within:outline-offset-2",
      "has-[:focus-visible]:outline-2",
      "has-[:focus-visible]:ring-offset-2",
      "peer-focus-visible:ring-2",
      "focus-visible:after:outline-2",
      "group-focus-visible/row:ring",
      "focus-visible:-outline-offset-2",
      "has-focus-visible:outline-2",
      "group-has-[:focus-visible]:ring-2",
      "group-has-focus-visible/row:outline-offset-1",
      "[&:focus-visible]:outline-2",
    ]);
  });

  it("leaves the two utilities, colour, an outline switched off (the next guard's), and rings that are not focus", () => {
    expect(
      handDrawnRings(
        "focus-visible:focus-ring-inset peer-focus-visible:focus-ring has-[:focus-visible]:focus-ring focus:ring-primary focus:outline-none outline-2 outline-offset-1 ring-2 has-[:checked]:ring-2 has-checked:ring-2",
      ),
    ).toEqual([]);
  });

  /**
   * A width or an offset under a focus variant is a second spelling of the
   * ring. Where the focused element is hidden (an `sr-only` input inside a
   * label, a switch's track), the stand-in wears `focus-ring` under
   * `has-[:focus-visible]:` or `peer-focus-visible:`; where a row sits flush
   * inside an `overflow-hidden` container, it wears
   * `focus-visible:focus-ring-inset` (docs/design/forms-and-controls.md,
   * "Focus rings").
   */
  it("finds no ring geometry under a focus variant anywhere in src/", () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      handDrawnRings(readFileSync(file, "utf8")).map(
        (token) => `${path.relative(SRC, file)}: ${token}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});

/**
 * **An outline switched off is a focus state removed.** While the global rule
 * sat outside any layer it beat `outline-none` on everything it rings, so the
 * class did nothing. In `@layer base` the utility wins, and `outline-none` on
 * an `a`, `button`, `input`, `select`, `textarea` or `summary` leaves a
 * keyboard user nothing to see. Three already did when the rule moved
 * (review, 2026-09-25); the command palette's field draws its ring inset now.
 *
 * What is left alone: a lowercase tag the global rule never rings, which in
 * this codebase is always a `tabIndex={-1}` container a script moves focus
 * into (the skip link's target, a dialog, a sheet); and the elements named in
 * `FOCUS_SHOWN_ELSEWHERE`, whose focus is drawn on another box. A component
 * tag (`<Link>`) renders one of the six, so it is refused like them, and so is
 * a class string outside any tag, which could land on anything.
 */
const OUTLINE_OFF = /^!?outline-(?:none|hidden|0)!?$/;
const RINGED = new Set(["a", "button", "input", "select", "textarea", "summary"]);

/**
 * `[file, anchor in the element's class string, the class in the same file that
 * draws its focus instead]`. Which element wears that class is pinned by the
 * component's own rendered test (table.test.tsx, TipAmountPicker.test.tsx).
 */
const FOCUS_SHOWN_ELSEWHERE: readonly (readonly [file: string, anchor: string, shownBy: string])[] =
  [
    // RowLink: the ring is on its `::after` overlay, the target a pointer has.
    [
      "components/ui/table.tsx",
      "after:absolute after:inset-0",
      "focus-visible:after:focus-ring-inset",
    ],
    // The tip picker's amount field: the bordered label around it is ringed.
    [
      "app/ready/[token]/_components/TipAmountPicker.tsx",
      "w-16 bg-transparent",
      "has-[:focus-visible]:focus-ring",
    ],
  ];

/** Comments carry class names as prose: blank them, keeping every offset. */
function withoutComments(source: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(
      /(^|[^:"'`\\])(\/\/[^\n]*)/g,
      (_, lead: string, comment: string) => lead + blank(comment),
    );
}

type OutlineOff = { token: string; tag: string | null; run: string };

/**
 * The JSX tag whose attributes end `before`, or `null` when the nearest tag
 * has already closed. A tag opens after anything but an identifier
 * (`useState<number>` is a generic), and a `>` outside braces that is not an
 * arrow's closes it.
 */
function openTagAround(before: string): string | null {
  const open = [...before.matchAll(/(?<![\w$.])<([A-Za-z][\w.]*)[\s>]/g)].at(-1);
  if (open === undefined) return null;
  const attrs = before.slice((open.index ?? 0) + open[0].length - 1);
  let depth = 0;
  for (let index = 0; index < attrs.length; index++) {
    const char = attrs[index];
    if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (char === ">" && depth === 0 && attrs[index - 1] !== "=") return null;
  }
  return open[1] ?? null;
}

/**
 * Every `outline-none`, `outline-hidden` and `outline-0` in `source`, under
 * any variant, with the JSX tag whose attributes it sits in (`null` when it is
 * in no tag) and the quoted class-string run around it.
 */
function outlinesOff(source: string): OutlineOff[] {
  const code = withoutComments(source);
  const runs = [...code.matchAll(/"[^"\n]*"|`[^`]*`/g)];
  return [...code.matchAll(/[^\s"'`{}()$,]+/g)].flatMap((match) => {
    if (!OUTLINE_OFF.test(segments(match[0]).at(-1) ?? "")) return [];
    const at = match.index ?? 0;
    const run =
      runs.find((r) => (r.index ?? 0) <= at && at < (r.index ?? 0) + r[0].length)?.[0] ?? "";
    return [{ token: match[0], tag: openTagAround(code.slice(0, at)), run }];
  });
}

function focusShownElsewhere(file: string, source: string, off: OutlineOff): boolean {
  if (off.tag !== null && /^[a-z]/.test(off.tag) && !RINGED.has(off.tag)) return true;
  return FOCUS_SHOWN_ELSEWHERE.some(
    ([where, anchor, shownBy]) =>
      file === where && off.run.includes(anchor) && withoutComments(source).includes(shownBy),
  );
}

function outlinesRemoved(source: string, file: string): string[] {
  return outlinesOff(source)
    .filter((off) => !focusShownElsewhere(file, source, off))
    .map((off) => `<${off.tag ?? "?"}> ${off.token}`);
}

describe("no control switches its outline off", () => {
  it("refuses it on an element the global ring reaches, on a component, and in a class string outside any tag", () => {
    expect(
      outlinesRemoved(
        [
          `<input className="w-full outline-none" />`,
          `<a href="/trips" className="focus:outline-none">`,
          `<button type="button" className={\`px-3 focus-visible:outline-hidden \${x}\`}>`,
          `<summary className="outline-0">`,
          `<Link href="/" className="outline-none">Home</Link>`,
          `const [n] = useState<number>(0);`,
          `const LOOSE = "rounded-lg outline-none";`,
        ].join("\n"),
        "app/example.tsx",
      ),
    ).toEqual([
      "<input> outline-none",
      "<a> focus:outline-none",
      "<button> focus-visible:outline-hidden",
      "<summary> outline-0",
      "<Link> outline-none",
      "<?> outline-none",
    ]);
  });

  it("leaves a container a script focuses, prose in a comment, and a named element only while the class that shows its focus is beside it", () => {
    expect(
      outlinesRemoved(
        [
          `<div id="main-content" tabIndex={-1} className="flex-1 outline-none">`,
          `<section role="dialog" tabIndex={-1} className={\`rounded-t-[22px] outline-none \${c}\`}>`,
          "// an `outline-none` in a comment is prose",
          "{/* the dialog's `outline-none` */}",
        ].join("\n"),
        "app/example.tsx",
      ),
    ).toEqual([]);
    const tip = "app/ready/[token]/_components/TipAmountPicker.tsx";
    expect(
      outlinesRemoved(
        `<label className="border has-[:focus-visible]:focus-ring"><input className="w-16 bg-transparent focus:outline-none" /></label>`,
        tip,
      ),
    ).toEqual([]);
    expect(
      outlinesRemoved(`<input className="w-16 bg-transparent focus:outline-none" />`, tip),
    ).toEqual(["<input> focus:outline-none"]);
  });

  it("finds none in src/ outside a focused container and the named elements", () => {
    const found = sourceFiles(SRC).flatMap((file) =>
      outlinesRemoved(readFileSync(file, "utf8"), path.relative(SRC, file)).map(
        (off) => `${path.relative(SRC, file)}: ${off}`,
      ),
    );
    expect(found).toEqual([]);
  });

  it.each(FOCUS_SHOWN_ELSEWHERE)(
    "%s still switches an outline off on the element with %s, so the exception is live",
    (file, anchor) => {
      const offs = outlinesOff(readFileSync(path.join(SRC, file), "utf8"));
      expect(offs.some((off) => off.run.includes(anchor))).toBe(true);
    },
  );
});

/**
 * `"…"` and `` `…` `` runs in `source` whose tokens include every one of
 * `needs`, found by an `anchor` the element's class string already carries.
 */
function classStringsWith(source: string, anchor: string, needs: readonly string[]) {
  return [...source.matchAll(/"[^"\n]*"|`[^`]*`/g)]
    .map(([run]) => run)
    .filter((run) => run.includes(anchor))
    .filter((run) => {
      const tokens = new Set(run.split(/[\s"`${}]+/));
      return needs.every((token) => tokens.has(token));
    });
}

/**
 * **Every element the probe measured a clipping ancestor cutting the ring
 * from**, and what it wears now (`e2e/pixel-probe`, check
 * `focus-ring-clipped`). Rows flush inside an `overflow-hidden` card or a
 * scroll box, or bled to 4px from the screen edge by a `-mx-3`, take the ring
 * inset; where one meets the container's rounded corner it also takes the
 * container's radius, or the clip shaves the ring's square corner. A strip that
 * scrolls sideways keeps the outset ring and gets room for it instead, and so
 * does a row whose padding was the defect.
 *
 * These are class strings, read from source. An element whose component
 * renders in jsdom is pinned in that component's own test instead, which
 * asserts on the rendered element: `DisclosureRow` (disclosure.test.tsx),
 * `SettingsRow` and the settings rail (SettingsRail.test.tsx), `FilterChips`,
 * the storefront's course cards (CoursesShelf.test.tsx), the About card
 * (TripAboutSection.test.tsx), the product page's chapter strip
 * (ProductChapterNav.test.tsx), the command palette's field
 * (CommandPalette.test.tsx), `RowLink` (table.test.tsx), the tip picker
 * (TipAmountPicker.test.tsx), the roll-call mark (DiverRollCall.test.tsx,
 * CrewRollCall.test.tsx), the diver record's shelf rows (ShelfGroup.test.tsx),
 * "Remove address" (AddressSearch.test.tsx) and the roster seat's foot row
 * (RosterSection.test.tsx).
 */
const CUT_RINGS: readonly (readonly [file: string, anchor: string, needs: readonly string[]])[] = [
  // The roll-call row's person button, 4px in from the card edge behind its
  // tone rule, and flush with the card's top on the first row: cut 1px left
  // and 5px top. The panel radius is the card's, so the ring's corners nest
  // in the card's at the ends without the row knowing it is an end.
  [
    "app/shop/[shopSlug]/trips/[id]/manifest/_components/RollCallControls.tsx",
    "min-h-19",
    ["focus-visible:focus-ring-inset", "rounded-panel"],
  ],
  // The offline manifest's saved-trip rows, cut left, right and top.
  [
    "components/OfflineManifestView.tsx",
    "p-4 transition-colors hover:bg-surface-sunken focus-visible:bg-surface-sunken",
    ["focus-visible:focus-ring-inset", "rounded-[inherit]"],
  ],
  ["components/OfflineManifestView.tsx", "first:rounded-t-panel last:rounded-b-panel", []],
  // The command palette's options, full width in a scroll box: cut left and right.
  [
    "components/search/CommandPalette.tsx",
    "flex w-full items-center gap-3 px-5 py-2.5",
    ["focus-visible:focus-ring-inset"],
  ],
  // The route editor's click surface fills the map window: cut on three sides.
  [
    "app/shop/[shopSlug]/dive-sites/_components/RouteEditor.tsx",
    "cursor-crosshair",
    ["focus-visible:focus-ring-inset", "rounded-t-lg"],
  ],
  // The dive site's upcoming departures, full-bleed rows in a card: cut left and right.
  [
    "app/shop/[shopSlug]/dive-sites/[id]/page.tsx",
    "px-4 py-3 text-sm hover:bg-surface-sunken",
    ["focus-visible:focus-ring-inset", "rounded-[inherit]"],
  ],
  ["app/shop/[shopSlug]/dive-sites/[id]/page.tsx", "last:rounded-b-panel", []],
  // Rows that bleed `-mx-3` into a 16px gutter sit 4px from a 390px
  // screen's edge: the viewport cut 1px off each side.
  [
    "app/s/[shopSlug]/_components/WeekLedger.tsx",
    "absolute inset-0 z-0 rounded-inset",
    ["focus-visible:focus-ring-inset"],
  ],
  [
    "app/s/[shopSlug]/courses/page.tsx",
    "group -mx-3 flex gap-4",
    ["focus-visible:focus-ring-inset"],
  ],
  ["app/dive/page.tsx", "group -mx-3 flex items-baseline", ["focus-visible:focus-ring-inset"]],
  [
    "app/dive/[region]/page.tsx",
    "group -mx-3 flex items-center",
    ["focus-visible:focus-ring-inset"],
  ],
  [
    "components/editor/EditorRail.tsx",
    "min-h-11 items-center rounded-lg px-3 py-2",
    ["focus-visible:focus-ring-inset"],
  ],
  ["components/JumpNav.tsx", "focus-visible:focus-ring-inset", []],
  // The contrast switch's pills scroll sideways in a 4px track.
  [
    "components/AmbientGlareDetector.tsx",
    "rounded-full px-3 text-sm font-semibold",
    ["has-[:focus-visible]:focus-ring-inset"],
  ],
];

describe("no ring the probe measured cut is cut any more", () => {
  it.each(CUT_RINGS)("%s — %s", (file, anchor, needs) => {
    const source = readFileSync(path.join(SRC, file), "utf8");
    expect(
      classStringsWith(source, anchor, needs),
      `a class string with "${anchor}" carrying ${needs.join(", ") || "it"}`,
    ).not.toHaveLength(0);
  });
});

/**
 * **A round radio gets a round ring.** An outline follows the element's
 * `border-radius`, and a native radio computes a radius of 0 however round
 * the browser draws it — so the global ring drew a 3px square around a 16px
 * circle on the waiver's guardian choice, `/ready`'s easing-back answers and
 * the calls log (pixel probe, state atlas). In the base layer beside the ring,
 * so a radio that styles itself can still say otherwise.
 */
describe("the ring on a native radio", () => {
  it("follows the circle the browser draws", () => {
    const radio = layerBase.find((rule) => /input\[type="radio"\]/.test(rule.prelude));
    expect(radio, 'an input[type="radio"] rule inside @layer base').toBeDefined();
    expect(declarations(radio?.body ?? "")["border-radius"]).toMatch(/^(9999px|50%)$/);
  });
});

/**
 * **On the sky, the ring is the sky's ink.** `--focus-ring` is `--primary`,
 * measured against the app's light surfaces, and a `SkyBand` is none of
 * them: lagoon on the day sky measured 1.78–1.89:1 and 1.28:1 at the band's
 * foot, under the 3:1 a focus indicator owes (pixel probe, state atlas, the
 * BOARD back link on `trip-repeating-panel`). Every focusable on a band —
 * `VoyageHeader`, `DayHeader`, `ShopfrontHero` — stands on the sky itself, so
 * the band retokens the ring once for all of them.
 */
describe("the ring on a SkyBand", () => {
  it("is the band's own ink", () => {
    const sky = unlayeredRules(CSS).find((rule) => rule.prelude === ".sky");
    expect(sky, "a .sky rule").toBeDefined();
    expect(declarations(sky?.body ?? "")["--focus-ring"]).toBe("var(--sky-ink)");
  });
});
