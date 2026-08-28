import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHROME_BAR_CLASS } from "./ChromeBar";

/**
 * The chrome bar's rules, as a test — ADR
 * 20260827-clearwater-surface-language, decision 10.
 *
 * The failure this guards is not a style regression. The staff bar's height
 * used to be content-driven (a padded row, 69px in practice), so a surface
 * that needed to pin something *under* it had no way to ask how tall it was:
 * `ScheduleBuilder` measured it once and wrote `sticky top-[68px]` three
 * directories away, and the public schedule's day headers pinned at `top-0`
 * and simply lived behind the bar. Both are silent when wrong — the day header
 * hides, or floats in a band of dead space, and every test still passes.
 *
 * So the height is a token now, read by the bar and by everything pinned
 * beneath it, and this file refuses the numeric literal that started it.
 *
 * A text scan rather than a rendered assertion, for the same reason
 * `stacking-layers.test.ts` is one: the defect is a class token in a file that
 * needs no props or data to be wrong, and no jsdom render can compare a day
 * header in one route against a bar that lives in a different layout. The e2e
 * counterpart — that the pinned header actually lands flush under the actual
 * bar, at three widths, on both shells — is
 * `e2e/schedule-builder.spec.ts`'s "a pinned day header sits flush under the
 * chrome bar".
 */

const CHROME_MODULE = path.join("src", "components", "chrome");
const SCAN_ROOTS = ["src/app", "src/components", "src/features", "e2e"];

/**
 * The offset properties that can pin something under the bar. A bracketed
 * value on any of these is a *measurement*, and the rule is that the measured
 * part must come from a variable rather than from somebody's ruler:
 * `top-[68px]`, `pt-[68px]`, `scroll-mt-[3.5rem]` and `top-[calc(68px+1rem)]`
 * are all refused; `top-(--chrome-h)`,
 * `scroll-mt-[calc(var(--chrome-h)+11rem)]` and
 * `bottom-[calc(1rem+var(--dock-clearance,0rem))]` are all fine, because in
 * each of those the thing being cleared names itself.
 *
 * Property-first on purpose. The first version of this rule required the
 * literal token `sticky` or `fixed` on the same *line*, which meant it could
 * not see `pt-[68px]`, could not see a class string the formatter had wrapped,
 * and could not see `cx("sticky z-20", "top-[68px]")` — three of the four
 * shapes the ADR says it refuses.
 */
const BRACKETED_OFFSET =
  /\b(?:top|bottom|inset|inset-x|inset-y|pt|mt|scroll-mt|scroll-pt)-\[([^\]]*)\]/g;
/** A hand-written distance: `68px`, `3.5rem`, `0.5em`, or a bare number. */
const ABSOLUTE_LENGTH = /(?:^|[^\w.-])\d+(?:\.\d+)?(?:px|rem|em)?(?:$|[^\w.%-])/;

/**
 * Tailwind's own scale on a viewport-pinned element — `sticky top-20`, which
 * is how the roll-call panel spent this slice pinned 24px below a bar that had
 * become 56px. `top-0` is the top of the viewport (where the bar itself sits,
 * and where an embed's chrome-less list starts) and `top-(--chrome-h)` is the
 * bar reading its own height; every other value is a number somebody chose.
 *
 * A variant-prefixed `focus:fixed` is excluded: the skip link is a transient
 * overlay that deliberately paints *over* the chrome, not page furniture
 * pinned beneath it.
 *
 * Applied to one extracted string literal or template at a time, so a class
 * list the formatter wrapped across lines is still one unit. The gap it
 * cannot close is a class split across separate arguments —
 * `cx("sticky", "top-20")` — where `BRACKETED_OFFSET` is the backstop for the
 * literal form.
 */
const PINNED = /(?<![\w:-])(?:sticky|fixed)(?![\w-])/;
const SCALE_TOP = /(?<![\w:-])top-(?!0(?![\w.])|\()[\w.]+/;

/** Every quoted string and template literal, each as one token. */
function stringTokens(source: string): string[] {
  return source.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) ?? [];
}

/** Blank comment bodies, keeping newlines so line numbers still point at code. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (line) => line.replace(/[^\n]/g, " "));
}

async function sourceFilesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFilesUnder(full)));
    } else if (
      (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) &&
      !entry.name.includes(".test.")
    ) {
      files.push(full);
    }
  }
  return files;
}

async function read(file: string): Promise<string> {
  return await readFile(path.join(process.cwd(), file), "utf8");
}

/**
 * Every hand-written chrome offset in a chunk of (comment-stripped) source,
 * as the sentence a reader needs to fix it.
 */
function offendingOffsets(source: string): string[] {
  const reasons: string[] = [];
  for (const [whole, value] of source.matchAll(BRACKETED_OFFSET)) {
    if (!ABSOLUTE_LENGTH.test(value) || value.includes("var(--")) continue;
    reasons.push(
      `\`${whole}\` is a distance somebody measured; read what it clears — top-(--chrome-h), or calc(var(--chrome-h) + …)`,
    );
  }
  for (const token of stringTokens(source)) {
    if (!PINNED.test(token)) continue;
    const scale = token.match(SCALE_TOP);
    if (!scale) continue;
    reasons.push(
      `\`${scale[0]}\` pins a sticky/fixed element at a number; the bar's height is top-(--chrome-h)`,
    );
  }
  return reasons;
}

describe("the chrome bar", () => {
  /**
   * The detector, pinned against the shapes it has to catch and the ones it
   * must not. Without this the guard is an assertion about a regex nobody has
   * ever run against a positive case — which is what it was: it went green
   * while `sticky top-20` sat on the roll-call panel, and it could not see
   * `pt-[68px]` or `scroll-mt-[3.5rem]` at all.
   */
  it("refuses a hand-written offset, and only a hand-written offset", () => {
    const refused = [
      'className="sticky top-[68px] z-20"',
      'className="pt-[68px]"',
      'className="scroll-mt-[3.5rem]"',
      'className="sticky top-[calc(68px+1rem)]"',
      'cx("sticky z-20", "top-[68px]")',
      "className={`sticky z-20\n  top-[68px]`}",
      'className="sticky top-20 z-10"',
      'className="fixed inset-x-0 top-20 z-40"',
    ];
    const allowed = [
      'className="sticky top-0 z-30"',
      'className="sticky top-(--chrome-h) z-20"',
      'className="scroll-mt-[calc(var(--chrome-h)+11rem)]"',
      'className="fixed bottom-[calc(1rem+var(--dock-clearance,0rem))]"',
      'className="pt-[12vh]"',
      'className="absolute top-11 bottom-2"',
      'className="focus:fixed focus:top-2"',
    ];
    expect(refused.filter((sample) => offendingOffsets(sample).length === 0)).toEqual([]);
    expect(allowed.filter((sample) => offendingOffsets(sample).length > 0)).toEqual([]);
  });

  it("leaves no hand-written chrome offset anywhere outside the chrome module", async () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of await sourceFilesUnder(root)) {
        const relative = path.relative(process.cwd(), file);
        if (relative.startsWith(CHROME_MODULE)) continue;
        for (const reason of offendingOffsets(withoutComments(await readFile(file, "utf8")))) {
          offenders.push(`${relative} — ${reason}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("leaves no hand-written chrome offset in the stylesheet either", async () => {
    const css = await read("src/app/globals.css");
    const offenders = [...css.matchAll(/(?:^|[\s;{])(top|scroll-padding-top)\s*:\s*([^;}]+)/g)]
      .filter(([, , value]) => /\d/.test(value) && !/^0\w*$/.test(value.trim()))
      .map(([, property, value]) => `${property}: ${value.trim()}`);
    expect(offenders).toEqual([]);
  });

  it("declares its height once, as a token, at the 56px the ADR names", async () => {
    const css = await read("src/app/globals.css");
    // Inside `@theme`, which is what publishes it to `:root` for the
    // `h-(--chrome-h)` / `top-(--chrome-h)` utilities to resolve against.
    const theme = css.slice(css.indexOf("@theme {"), css.indexOf("@theme inline"));
    expect(theme).toContain("--chrome-h: 3.5rem;");
    // Declared once. A second declaration is two bars again, wearing one name.
    expect(css.match(/--chrome-h:/g)).toHaveLength(1);
  });

  it("pins itself at one height, one edge and one layer", () => {
    expect(CHROME_BAR_CLASS).toContain("h-(--chrome-h)");
    expect(CHROME_BAR_CLASS).toContain("sticky top-0");
    expect(CHROME_BAR_CLASS).toContain("z-30");
    expect(CHROME_BAR_CLASS).toContain("border-b border-border");
    expect(CHROME_BAR_CLASS).toContain("print:hidden");
    // Translucent page background *behind a blur*, and solid where the blur
    // cannot run — a see-through bar with nothing blurring behind it is just
    // the page showing through the navigation.
    expect(CHROME_BAR_CLASS).toContain("backdrop-blur-xl");
    expect(CHROME_BAR_CLASS).toContain("supports-[backdrop-filter]:bg-background/85");
    expect(CHROME_BAR_CLASS).toMatch(/(?:^|\s)bg-background(?:\s|$)/);
    // Elevation is earned (decision 1): the bar is always there, so it is not
    // floating, so it carries no shadow.
    expect(CHROME_BAR_CLASS).not.toContain("shadow");
  });

  it("is the only bar either shell renders, so both are one height", async () => {
    for (const shell of ["src/components/ShopNav.tsx", "src/components/PublicShopChrome.tsx"]) {
      const source = withoutComments(await read(shell));
      expect(source, `${shell} does not render through ChromeBar`).toContain("<ChromeBar");
      // No second bar hand-rolled beside it. This is what the public shell's
      // own `z-40` header was, and why its day headers hid behind it.
      expect(source, `${shell} still hand-rolls a sticky header`).not.toMatch(
        /<header[^>]*sticky/s,
      );
      expect(source, `${shell} still carries its own chrome layer`).not.toContain("z-40");
    }
  });

  it("leaves the page's own title, and the day headers' offset, to the page", async () => {
    const bar = withoutComments(await read("src/components/chrome/ChromeBar.tsx"));
    // No collapsing large title: the ADR deferred that deliberately, because
    // it needs a scroll listener under every page.
    expect(bar).not.toContain("<h1");
    // And no connectivity indicator: `ConnectivityStatus` stays a page-level
    // `onlyWhenOffline` mount, so the chrome says nothing on an ordinary day.
    expect(bar).not.toContain("ConnectivityStatus");

    // The two surfaces the ADR names by hand, reading the bar's own height.
    const board = await read(
      "src/app/shop/[shopSlug]/schedule/board/_components/ScheduleBuilder.tsx",
    );
    expect(board).toContain("sticky top-(--chrome-h)");
    const publicSchedule = await read("src/app/s/[shopSlug]/page.tsx");
    expect(publicSchedule).toContain('"top-(--chrome-h)"');
  });
});
