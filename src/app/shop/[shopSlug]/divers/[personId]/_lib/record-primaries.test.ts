import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **The record has exactly one primary-weight control.**
 *
 * The second of the two rules ADR 20260827-people-not-lists pins on the diver
 * record ("Book them on a departure is the page's **one primary**"). Before the
 * recomposition the page carried three to four filled buttons at once — Book an
 * activity, Restore, a Connect-payments CTA, and whichever destructive control
 * the reader's role unlocked — so nothing on it led.
 *
 * It is a **source sweep** rather than a render, deliberately. The rule is
 * about the whole page, whose render needs a session, a shop row, a database
 * and a dozen authz reads; and the realistic regression is a *new* control
 * somewhere in the folder reaching for `buttonClass()` with no variant, which
 * a render of one component would never see. `buttonClass`'s default variant
 * is `primary` (src/components/ui/button.ts), so "no `variant:` in the call" is
 * exactly what a primary looks like in source.
 *
 * **Two files may hold one, and they are mutually exclusive on screen.**
 * `BookActivity` is the record's primary; `RestoreDiver` renders *only* on a
 * removed record, where Book is deliberately absent (seating a removed diver
 * would walk them back onto a manifest). So a reader sees one filled button in
 * either state, never two.
 */

const ROUTE = join(process.cwd(), "src/app/shop/[shopSlug]/divers/[personId]");

/** The files that may each hold one primary, and why — see the docstring above. */
const ALLOWED = new Set(["BookActivity.tsx", "RestoreDiver.tsx"]);

/** The argument text of every `buttonClass(...)` call in a source file. */
function buttonClassCalls(source: string): string[] {
  const calls: string[] = [];
  const needle = "buttonClass(";
  let at = source.indexOf(needle);
  while (at !== -1) {
    let depth = 0;
    let end = at + needle.length - 1;
    for (; end < source.length; end += 1) {
      if (source[end] === "(") depth += 1;
      else if (source[end] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(source.slice(at + needle.length, end));
    at = source.indexOf(needle, end);
  }
  return calls;
}

function tsxFilesUnder(dir: string): { name: string; path: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFilesUnder(path);
    if (!entry.name.endsWith(".tsx") || entry.name.endsWith(".test.tsx")) return [];
    return [{ name: entry.name, path }];
  });
}

describe("the diver record's one primary", () => {
  it("has exactly one filled control, in the two mutually exclusive places it may live", () => {
    const holders = tsxFilesUnder(ROUTE)
      .filter(({ path }) =>
        // A call with no `variant:` takes the default, which is `primary`.
        buttonClassCalls(readFileSync(path, "utf8")).some((args) => !args.includes("variant:")),
      )
      .map(({ name }) => name)
      .sort();
    expect(holders).toEqual([...ALLOWED].sort());
  });

  it("keeps Book and Restore off the screen at the same time", () => {
    // The page hands `book` only to a live record and mounts `RestoreDiver`
    // only on a removed one, so the two primaries can never render together.
    const page = readFileSync(join(ROUTE, "page.tsx"), "utf8");
    expect(page).toContain("removed ? null : (");
    expect(page).toContain("{removed ? (\n        <RestoreDiver");
  });
});
