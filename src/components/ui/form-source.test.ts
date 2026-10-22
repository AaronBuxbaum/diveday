// Source-policy contracts run in the guards project, never in the jsdom behavior suite.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **`hint` is a short qualifier, and the type cannot say so.**
 *
 * It takes a `ReactNode` and renders whatever it is given, so a sentence and
 * "(optional)" are the same thing to the compiler — and the two props read as
 * interchangeable from a call site. `/onboard` passed a **31-word** sentence as
 * `hint`, which pushed the caption row to five lines, left a ~100px hole beside
 * it in the two-column grid, floated the required `*` at the end of a
 * paragraph, and — because `hint` renders *inside* the `<label>* — folded all
 * thirty-one words into the control's accessible name, so a screen reader read
 * them out every time the field was announced (issue #784).
 *
 * Nothing failed. The layout hole only appears at one breakpoint with that
 * particular string length, and `/onboard` had no capture.
 *
 * So the ceiling is stated here instead. The bound is deliberately generous —
 * it is not a style rule about brevity, it is the line past which `hint` is
 * the wrong prop and `description` is the right one, which is a question of
 * *where the text renders*, not of taste.
 */
const HINT_WORD_CEILING = 15;

/** Every `hint={t("…")}` in the app, with the words it resolves to. */
function hintsWithText(): { file: string; key: string; words: number; text: string }[] {
  const messages = new Map<string, string>();
  const flatten = (node: unknown, path: string) => {
    if (typeof node === "string") messages.set(path, node);
    else if (node && typeof node === "object")
      for (const [key, value] of Object.entries(node))
        flatten(value, path ? `${path}.${key}` : key);
  };
  // Both vocabularies, keyed the way a translator call spells them. `diver.json`
  // is namespaced by its own top-level keys; a staff bundle is one file per
  // area and the **filename** is the namespace (`staff/boats.json` →
  // `boats.…`), which is the composition `staff/index.ts` performs.
  const localeRoot = path.join(process.cwd(), "src/i18n/locales/en-US");
  flatten(JSON.parse(readFileSync(path.join(localeRoot, "diver.json"), "utf8")), "");
  const staffRoot = path.join(localeRoot, "staff");
  for (const entry of readdirSync(staffRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    flatten(
      JSON.parse(readFileSync(path.join(staffRoot, entry.name), "utf8")),
      entry.name.replace(/\.json$/, ""),
    );
  }

  const found: { file: string; key: string; words: number; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")) {
        const source = readFileSync(full, "utf8");
        for (const match of source.matchAll(/\bhint=\{t\(\s*"([^"]+)"/g)) {
          const key = match[1];
          if (!key) continue;
          const text = messages.get(key);
          // A key this scan cannot resolve is not a finding: staff bundles are
          // composed under their own namespace and a few hints are computed.
          if (!text) continue;
          found.push({
            file: path.relative(process.cwd(), full),
            key,
            words: text.trim().split(/\s+/).length,
            text,
          });
        }
      }
    }
  };
  for (const root of ["src/app", "src/components"]) walk(path.join(process.cwd(), root));
  return found;
}

describe("Field's hint stays a qualifier", () => {
  it("finds enough hints to be worth asserting on", () => {
    // A scan that silently resolves nothing would pass forever.
    expect(hintsWithText().length).toBeGreaterThan(20);
  });

  it("refuses a hint long enough to belong in `description`", () => {
    const overlong = hintsWithText()
      .filter((hint) => hint.words > HINT_WORD_CEILING)
      // Named, not counted: the fix is per call site and needs the key.
      .map(
        (hint) => `${hint.file} — ${hint.key} (${hint.words} words): ${hint.text.slice(0, 60)}…`,
      );
    expect(overlong).toEqual([]);
  });
});

/**
 * **Source sweeps: a call site stays on the primitive.** A shared piece fixes
 * a defect once only while nothing spells around it, so each rule below reads
 * every `.tsx` under `src/` (tests aside, comments stripped, so a doc comment
 * quoting the old spelling is not a finding) and names the file and line of
 * anything that does.
 */
type SourceFile = { file: string; source: string };

function sourceFiles(): SourceFile[] {
  const found: SourceFile[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) {
        const source = readFileSync(full, "utf8")
          // Block and JSX comments, kept as blank lines so line numbers hold.
          .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
          // Whole-line `//` comments only: a `//` mid-line may be a URL.
          .replace(/^[ \t]*\/\/.*$/gm, "");
        found.push({ file: path.relative(process.cwd(), full), source });
      }
    }
  };
  walk(path.join(process.cwd(), "src"));
  return found;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/**
 * Every opening `<tag …>` of one JSX element name, whole: read up to the `>`
 * that closes it, stepping over `{…}` expressions (an arrow's `=>` is not the
 * end of a tag) and quoted attribute values.
 */
function openingTags(source: string, tag: string): { index: number; text: string }[] {
  const tags: { index: number; text: string }[] = [];
  const start = new RegExp(`<${tag}(?![A-Za-z0-9_])`, "g");
  for (const match of source.matchAll(start)) {
    let depth = 0;
    let quote: string | null = null;
    let end = match.index + match[0].length;
    for (; end < source.length; end++) {
      const char = source[end];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === "{") depth++;
      else if (char === "}") depth--;
      else if (depth === 0 && (char === '"' || char === "'")) quote = char;
      else if (depth === 0 && char === ">") break;
    }
    tags.push({ index: match.index, text: source.slice(match.index, end + 1) });
  }
  return tags;
}

/**
 * Where the element opened at `start` closes: the `</tag>` that brings the
 * count of open `<tag …>`s back to zero, stepping over self-closing ones. The
 * end of the source when it never closes.
 */
function closingTagIndex(source: string, tag: string, start: number): number {
  const edge = new RegExp(`<${tag}(?![A-Za-z0-9_])|</${tag}>`, "g");
  edge.lastIndex = start;
  let depth = 0;
  for (const match of source.matchAll(edge)) {
    if (match.index < start) continue;
    if (match[0] === `</${tag}>`) {
      depth--;
      if (depth === 0) return match.index;
    } else {
      // Bounded: an opening tag is never longer than this, and reading the
      // whole rest of the file for every tag would be quadratic.
      const [opening] = openingTags(source.slice(match.index, match.index + 5000), tag);
      if (!opening?.text.endsWith("/>")) depth++;
    }
  }
  return source.length;
}

describe("source sweeps", () => {
  it("reads enough of the app to be worth asserting on", () => {
    expect(sourceFiles().length).toBeGreaterThan(300);
  });

  /**
   * **A control keeps its 16px type.** An appended `text-sm`/`text-xs` wins
   * over `controlClass`'s `text-base` by stylesheet order, so one field drew
   * at three sizes on one page — "Assign crew…" at a 10px cap beside "Every
   * week" at 12px (trip-repeating-cadence, trip-crew-clash; K-45) — and iOS
   * Safari zooms the page when a box under 16px takes focus. There is no denser
   * control: every text control is `controlClass`, at 16px. The
   * one exception is the embed page's read-only code snippet, which is a
   * block of code to copy, not a box anyone types in.
   */
  it("never appends a smaller type size to a control's class", () => {
    const allowed = new Set(["src/app/shop/[shopSlug]/settings/embed/SnippetField.tsx"]);
    const offenders: string[] = [];
    for (const { file, source } of sourceFiles()) {
      if (allowed.has(file)) continue;
      const templates = /`[^`]*\$\{(?:controlClass|textareaClassFor\([^)]*\))\}[^`]*`/g;
      for (const match of source.matchAll(templates)) {
        if (/\btext-(xs|sm)\b/.test(match[0]))
          offenders.push(`${file}:${lineOf(source, match.index)} ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * **A bordered fieldset's legend starts on its fields' edge.** `px-1` pads
   * the notch the legend cuts in the border, and on its own it also moved the
   * words 4px right of every field under them (orders-new: legend text at 326,
   * fields at 322; K-289). `legendClass` is the notch with the words pulled
   * back, and nothing spells the padding by hand.
   */
  it("keeps a legend's notch padding in legendClass", () => {
    const offenders: string[] = [];
    for (const { file, source } of sourceFiles()) {
      for (const { index, text } of openingTags(source, "legend")) {
        if (/\bpx-1\b/.test(text)) offenders.push(`${file}:${lineOf(source, index)} ${text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * **A checkbox or radio a person sees is drawn one way.** Every visible box
   * wears `choiceClass` — directly, or through `ChoiceRow` / `ChoicePill`,
   * which are the only other places a box is spelled. K-13 found the platform's
   * 13px radios beside 16px checkboxes, `size-4` boxes without `shrink-0` that
   * squash beside a label long enough to wrap, and the forms plugin's classes
   * this app does not load (`rounded border-border text-primary
   * focus:ring-*`, which do nothing to a native box). A first sweep refused
   * only the unsized and the plugin-classed, and 43 of 52 visible boxes still
   * spelled `size-4` by hand, most without `shrink-0` (K-13 review). A box
   * that is `sr-only` or `opacity-0` is a stand-in's business, not this rule's.
   *
   * A visible radio wears `radioClass` instead — `choiceClass` with its own
   * outline off — and the box round it wears `radioRingClass`: a native
   * radio's ring is a square round a round dot, so it is drawn on the label
   * (#2007). This reads the input's tag and its file, not which element the
   * ring lands on; the rendered test above pins that for the two components.
   *
   * Two boxes are 20px on purpose and named here by path: the conditions
   * hold, a warning-tinted card whose box stands beside its 16px semibold
   * heading, and the buddy builder's drag rows, a manifest surface whose own
   * note asks for a box big enough to hit without aiming.
   */
  it("draws every visible choice box with choiceClass, and every radio with radioClass", () => {
    const deliberate20px = new Set([
      "src/app/shop/[shopSlug]/trips/[id]/_components/ConditionsSection.tsx",
      "src/app/shop/[shopSlug]/trips/[id]/manifest/_components/BuddyDragGroups.tsx",
    ]);
    const offenders: string[] = [];
    for (const { file, source } of sourceFiles()) {
      for (const { index, text } of openingTags(source, "input")) {
        if (!/type=(?:"|\{")(checkbox|radio)"/.test(text)) continue;
        if (/\b(sr-only|opacity-0)\b/.test(text)) continue;
        const where = `${file}:${lineOf(source, index)}`;
        if (/type=(?:"|\{")radio"/.test(text)) {
          if (!/\bradioClass\b/.test(text)) offenders.push(`${where} lacks radioClass`);
          else if (!/\bradioRingClass\b/.test(source))
            offenders.push(`${where} wears radioClass with no radioRingClass on its box`);
        } else if (!/\bchoiceClass\b/.test(text) && !deliberate20px.has(file))
          offenders.push(`${where} lacks choiceClass`);
        if (/\b(rounded|border-[a-z-]+|text-primary|focus:ring-[a-z-]+)\b/.test(text))
          offenders.push(`${where} wears forms-plugin classes`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // A pill is a 44px bordered row padded at its sides. A bordered *card*
  // padded all round (`p-3`), holding a title and a sentence — the merge
  // picker, the conditions hold — is another component and not this rule's.
  // The pill with something beside its words is a bordered `<div>` around its
  // label, so the rule reads those too: a hand-spelled one stood its box 4px
  // off the plain pill's beside it (RentalFitForm, K-13 review).
  it("draws every bordered answer pill with ChoicePill", () => {
    const offenders: string[] = [];
    const bordered = (text: string) =>
      ["rounded-lg", "border", "min-h-11"].every((token) =>
        new RegExp(`\\b${token}\\b`).test(text),
      );
    const holdsABox = (body: string) =>
      /type=(?:"|\{")(checkbox|radio)"/.test(body) && !/\bsr-only\b/.test(body);
    for (const { file, source } of sourceFiles()) {
      for (const { index, text } of openingTags(source, "label")) {
        if (!bordered(text) || !/\bpx-\d/.test(text)) continue;
        const body = source.slice(index + text.length, source.indexOf("</label>", index));
        if (holdsABox(body)) offenders.push(`${file}:${lineOf(source, index)}`);
      }
      for (const { index, text } of openingTags(source, "div")) {
        if (!bordered(text)) continue;
        const body = source.slice(index + text.length, source.indexOf("</div>", index));
        if (/<label\b/.test(body) && holdsABox(body))
          offenders.push(`${file}:${lineOf(source, index)} (a bordered div around a label)`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * A legend's gap to its choices belongs to `ChoiceFieldset` (K-72): a
   * legend with its own bottom margin is a caption drawn another way. A
   * floated legend is exempt — a float is how a legend escapes the rendered
   * legend's place in a bordered box, and the clearing sibling after it
   * cannot take a top margin (clearance absorbs it), so its margin is the
   * only one there is.
   */
  it("leaves the caption gap to ChoiceFieldset, never a legend's own margin", () => {
    const offenders: string[] = [];
    for (const { file, source } of sourceFiles()) {
      for (const { index, text } of openingTags(source, "legend")) {
        if (/\bfloat-/.test(text)) continue;
        if (/\bmb-/.test(text)) offenders.push(`${file}:${lineOf(source, index)} ${text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * A legend spelled as `ChoiceFieldset`'s caption (`text-sm font-medium`) is
   * a group caption drawn by hand, and the ones found sat 8px or 12px above
   * their choices where a field caption sits 4px: the rental "What to plan"
   * and nitrox groups (`mt-2`, and a pill written `mt-2` under its legend),
   * the staff rental toggles, the ready page's re-entry answers and a
   * departure's required specialties (`mt-3`), each
   * touched by the batch that moved its boxes (K-72 review). The rule's own
   * wording is that the rest follow as they are touched: the three below have
   * not been, and a file leaves this list the day it is. A bordered
   * fieldset's legend (`legendClass`, the notch in its border) is another
   * shape and not this rule's.
   */
  it("captions a group of choices with ChoiceFieldset, not a hand-spelled legend", () => {
    const notYetTouched = new Set([
      "src/app/shop/[shopSlug]/orders/new/page.tsx",
      "src/components/StarRatingInput.tsx",
      "src/components/RepeatFields.tsx",
    ]);
    const offenders: string[] = [];
    for (const { file, source } of sourceFiles()) {
      if (file === "src/components/ui/form.tsx" || notYetTouched.has(file)) continue;
      for (const { index, text } of openingTags(source, "legend")) {
        if (/\b(sr-only|legendClass)\b/.test(text)) continue;
        if (/\btext-sm\b/.test(text) && /\bfont-medium\b/.test(text))
          offenders.push(`${file}:${lineOf(source, index)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * A temporal box is a `DateField` (K-54): spelled bare, it wears the
   * platform's indicator and, on iOS, nothing at all when empty.
   */
  it("enters a month, a time or a date-and-time through DateField, never a bare input", () => {
    const offenders: string[] = [];
    for (const { file, source } of sourceFiles()) {
      if (file === "src/components/ui/form.tsx") continue;
      for (const { index, text } of openingTags(source, "input")) {
        if (/type="(date|month|time|datetime-local|week)"/.test(text))
          offenders.push(`${file}:${lineOf(source, index)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * A textarea on the bare control class stops growing with its text (K-46),
   * and one whose minimum disagrees with its `rows` draws two sizes: the
   * minimum where `field-sizing` works and `rows` where it does not.
   */
  it("draws every textarea with textareaClassFor, at its own rows", () => {
    const offenders: string[] = [];
    for (const { file, source } of sourceFiles()) {
      if (file === "src/components/ui/form.tsx") continue;
      for (const { index, text } of openingTags(source, "textarea")) {
        const where = `${file}:${lineOf(source, index)}`;
        if (/\bcontrolClass(For)?\b/.test(text)) offenders.push(`${where} on controlClass`);
        const min = text.match(/textareaClassFor\(([^)]*)\)/)?.[1]?.trim();
        const rows = text.match(/\brows=\{([^}]+)\}/)?.[1]?.trim();
        if (min !== undefined && min !== rows)
          offenders.push(`${where} rows={${rows}} but textareaClassFor(${min})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * **A `Field` wraps one control, never another label.** Without `htmlFor`,
   * a `Field` whose child is not one native control wraps it in its caption's
   * `<label>`; handed a composite holding labels of its own, it nested a label
   * in a label, which is invalid HTML, and the caption named whatever came
   * first. With a logo on file, "Logo" labelled the "Remove logo" box, so a
   * click on the caption ticked it; "Badges" labelled the first badge; the
   * embed's "Look" the first radio (K-13 review). Name the control with
   * `htmlFor`, caption a group of choices with `ChoiceFieldset`, or, where the
   * group must keep a `FieldGrid` row's caption line, pass `group`.
   */
  it("never wraps a label in a Field's caption label", () => {
    const labels = /<(label|ChoiceRow|ChoicePill|ImageFileInput|RemovablePhoto)\b/;
    const offenders: string[] = [];
    for (const { file, source } of sourceFiles()) {
      if (file === "src/components/ui/form.tsx") continue;
      for (const { index, text } of openingTags(source, "Field")) {
        if (text.endsWith("/>") || /\shtmlFor=/.test(text) || /\sgroup[\s/>]/.test(text)) continue;
        const body = source.slice(index + text.length, closingTagIndex(source, "Field", index));
        const hit = body.match(labels);
        if (hit) offenders.push(`${file}:${lineOf(source, index)} wraps <${hit[1]}>`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * **One gutter between a form's columns.** `FieldGrid` draws 16px, and call
   * sites appended `gap-x-5 gap-y-5`, which won by stylesheet order: on one
   * settings page the dock-day and fly-safe columns stood 20px apart and the
   * emergency and rental-price columns 16px (K-42). A form that ever wants a
   * different gutter gets it as a prop on `FieldGrid`, not as a class.
   */
  it("never overrides FieldGrid's column gutter at a call site", () => {
    const offenders: string[] = [];
    for (const { file, source } of sourceFiles()) {
      for (const { index, text } of openingTags(source, "FieldGrid")) {
        if (/\bgap-x-/.test(text)) offenders.push(`${file}:${lineOf(source, index)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * **An action row stands one field gap under the last control.** Inside a
   * `FieldGrid` that gap is the grid's own `gap-y-4`, so the row takes no
   * margin; a row set after a grid rather than in one takes `mt-4`, the same
   * 16px. "Add a diver" stacked an `mt-6` on the grid's gap and put its buttons
   * 40px under the phone field, and "Took a call" stood its row 24px under its
   * note, where every other form stands it 16px under (K-182).
   */
  it("never spaces a FieldActions row by anything but one field gap", () => {
    const offenders: string[] = [];
    for (const { file, source } of sourceFiles()) {
      for (const { index, text } of openingTags(source, "FieldActions")) {
        const margins = text.match(/(?<![\w-])m[ty]-[\w.[\]-]+/g) ?? [];
        if (margins.some((margin) => margin !== "mt-4")) {
          offenders.push(`${file}:${lineOf(source, index)} ${margins.join(" ")}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("form stylesheet contracts", () => {
  it("paints an empty box's mask in the placeholder's color", () => {
    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const placeholder = css.match(
      /input::placeholder,\s*textarea::placeholder\s*\{\s*color:\s*([^;]+);/,
    )?.[1];
    expect(placeholder).toBeDefined();
    // Not while the box has focus: the person's own digits take the ink.
    const mask = css.match(
      /input\[data-empty\]:not\(:focus\)::-webkit-datetime-edit\s*\{\s*color:\s*([^;]+);/,
    );
    expect(mask, "input[data-empty]:not(:focus)::-webkit-datetime-edit { color }").not.toBeNull();
    expect(mask?.[1]).toBe(placeholder);
  });
  it("insets the scrollport above sticky form actions", () => {
    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const rule = css.match(/html:has\(\[data-sticky-actions\]\)\s*\{([^}]*)\}/);
    expect(rule, "html:has([data-sticky-actions]) { … }").not.toBeNull();
    // The bar's measured height, and until it is measured (the server's
    // paint, a browser with no ResizeObserver) its one-row height: the md
    // button (3rem), the bar's py-3 (1.5rem) and its hairline — above the
    // tab bar it stands on.
    expect(rule?.[1]).toMatch(
      /scroll-padding-bottom:\s*calc\(var\(--sticky-actions-h,\s*calc\(3rem \+ 1\.5rem \+ 1px\)\)\s*\+\s*var\(--tabbar-h\)\)/,
    );
  });
});
