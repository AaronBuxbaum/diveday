import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read: the board is a Server Component that needs a display token
 * and a database to render, so this pins the classes that decide its geometry;
 * nothing here measures it. The skeleton's half is `loading.test.tsx`.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");

/** The classes of the first `<tag className="…">` in the page. */
function classesOf(tag: string): string[] {
  const match = SOURCE.match(new RegExp(`<${tag}\\s+className="([^"]+)"`));
  expect(match, `the page has a <${tag} className="…">`).not.toBeNull();
  return (match?.[1] ?? "").split(/\s+/);
}

describe("the departures board's header", () => {
  /**
   * **The date shares the shop name's last baseline** (K-256). `items-end`
   * lined up the two line boxes' bottoms, and a 44px heading's descent is
   * deeper than a 28px date's, so the date sat 4px under the name at 1280.
   * The last baseline, not the first, so a name that wraps keeps the date on
   * its last line.
   */
  it("sets the date on the shop name's last baseline", () => {
    const header = classesOf("header");
    expect(header).toContain("items-baseline-last");
    expect(header).not.toContain("items-end");
  });
});
