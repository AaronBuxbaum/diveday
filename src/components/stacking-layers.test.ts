import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The "which one is on top" footgun, as a test.
 *
 * The staff header (`ShopNav.tsx`) is `sticky top-0 z-30`, and every in-page
 * popover — the `<details>` panels that disclose a form beside the heading
 * that opened them — is meant to slide *under* it. They are page furniture,
 * not modals: nothing dims behind them, they do not trap focus, and a panel
 * covering the shop's own navigation while its identical sibling two sections
 * up does not is the kind of difference nobody can name but everybody notices.
 *
 * The specialty-certification panel was `z-30` and the certification panel
 * above it `z-20` — one character apart in two otherwise identical files. Tied
 * with the header, the panel won on DOM order and painted over it.
 *
 * A text scan rather than a rendered assertion, for the reason the bug itself
 * demonstrates: the failure is one class token in one file, it needs no props
 * or data to exist, and no jsdom render can compare a panel against a header
 * that lives in a different layout.
 */

const HEADER_LAYER = 30;
const ROOTS = ["src/app", "src/components"];

/**
 * Absolutely-positioned things that genuinely belong above the header, each
 * with the reason it earns the exception. An entry here is a decision; the
 * empty-by-default state is what makes the rule mean something.
 */
const ABOVE_HEADER_BY_DESIGN: Record<string, string> = {};

/** Every class string on one line that positions something and gives it a layer. */
const POSITIONED_LAYER =
  /\b(?:absolute|fixed|sticky)\b[^"'`]*\bz-(\d+)\b|\bz-(\d+)\b[^"'`]*\b(?:absolute|fixed|sticky)\b/g;

/**
 * Blank out comment bodies, keeping every newline so reported line numbers
 * still point at the real line. Without this the scan reads the sentence
 * *explaining* the bug in `SpecialtyCards.tsx` as the bug.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (line) => line.replace(/[^\n]/g, " "));
}

async function tsxFilesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await tsxFilesUnder(full)));
    } else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) {
      files.push(full);
    }
  }
  return files;
}

describe("stacking layers", () => {
  it("keeps the staff header above every in-page popover", async () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of await tsxFilesUnder(root)) {
        const source = await readFile(file, "utf8");
        const relative = path.relative(process.cwd(), file);
        // The header itself, and the toast/overlay layer above it, are what
        // the rule is measured against rather than cases of it.
        if (relative.endsWith("ShopNav.tsx") || relative.endsWith("PublicShopChrome.tsx")) continue;
        withoutComments(source)
          .split("\n")
          .forEach((line, index) => {
            for (const match of line.matchAll(POSITIONED_LAYER)) {
              const layer = Number(match[1] ?? match[2]);
              // `fixed` overlays (toasts, the phone dock, modal scrims) are a
              // different question — they cover the whole viewport on purpose.
              if (/\bfixed\b/.test(match[0])) continue;
              if (layer < HEADER_LAYER) continue;
              const at = `${relative}:${index + 1}`;
              if (ABOVE_HEADER_BY_DESIGN[relative]) continue;
              offenders.push(`${at} — z-${layer} ties or beats the header's z-${HEADER_LAYER}`);
            }
          });
      }
    }
    expect(offenders).toEqual([]);
  });
});
