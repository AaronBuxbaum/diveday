import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **One term column on every switching guide** (pixel-craft class 12, K-580).
 *
 * The spreadsheet guide's move rail holds two ruled term/detail tables one
 * phase apart: its own column list, then the shared scope table
 * (`ScopePhase` in `../_components/guide.tsx`). The column list kept
 * `sm:grid-cols-[11rem_1fr]` from the page's card layout while the scope
 * table and the website ledger use `15rem`, so on one rail the detail column
 * started at x 472 and then at x 536, and "Waivers and documents" wrapped in
 * a column too narrow for it.
 *
 * It reads the route sources because the pages are cached server components
 * with no render to inspect without a request; the rendered offsets are the
 * pixel probe's to measure (docs/design/pixel-craft.md).
 */

const SWITCHING_DIR = join(__dirname, "..");

/** Every page and component source under `src/app/switching`, tests excluded. */
function switchingSources(dir: string = SWITCHING_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return switchingSources(full);
    return entry.name.endsWith(".tsx") && !entry.name.includes(".test.") ? [full] : [];
  });
}

/** Every `sm:grid-cols-[<term>_1fr]` term width, with the file it sits in. */
function termColumns(): { file: string; width: string }[] {
  return switchingSources().flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/sm:grid-cols-\[([^\]_]+)_1fr\]/g)].map((match) => ({
      file: relative(SWITCHING_DIR, file),
      width: match[1],
    })),
  );
}

describe("the switching guides' ruled term/detail tables", () => {
  it("finds the tables it is guarding", () => {
    const files = new Set(termColumns().map(({ file }) => file));
    expect(files).toContain("spreadsheet/page.tsx");
    expect(files).toContain("_components/guide.tsx");
    expect(files).toContain("[competitor]/page.tsx");
  });

  it("start their detail column at one x: a 15rem term column from sm up", () => {
    const offWidth = termColumns().filter(({ width }) => width !== "15rem");
    expect(offWidth).toEqual([]);
  });
});
