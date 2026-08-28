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
const SCAN_ROOTS = ["src/app", "src/components", "src/features"];

/**
 * A sticky or fixed element pinned at a hand-written distance — `top-[68px]`,
 * `top-[4.25rem]`. The offsets that are *not* this are fine: `top-0` (the top
 * of the viewport, which is where the bar itself sits and where an embed's
 * chrome-less list starts) and Tailwind's own scale, which is a spacing
 * decision rather than a measurement of the chrome.
 */
const NUMERIC_STICKY_OFFSET =
  /\b(?:sticky|fixed)\b[^"'`]*\btop-\[\s*-?\d|\btop-\[\s*-?\d[^"'`]*\b(?:sticky|fixed)\b/;

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

describe("the chrome bar", () => {
  it("leaves no numeric chrome offset literal anywhere outside the chrome module", async () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of await sourceFilesUnder(root)) {
        const relative = path.relative(process.cwd(), file);
        if (relative.startsWith(CHROME_MODULE)) continue;
        withoutComments(await readFile(file, "utf8"))
          .split("\n")
          .forEach((line, index) => {
            if (NUMERIC_STICKY_OFFSET.test(line)) {
              offenders.push(
                `${relative}:${index + 1} — a pinned offset written as a number; read the bar's own height with top-(--chrome-h)`,
              );
            }
          });
      }
    }
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
