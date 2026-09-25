import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read: this is a Server Component page that needs a database to
 * render, so this pins the source that decides the geometry; nothing here
 * measures it.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");
const SEARCH_START = SOURCE.indexOf("<SearchField");
const SEARCH = SOURCE.slice(SEARCH_START, SOURCE.indexOf("/>", SEARCH_START));

/**
 * **The library's search box stands level with its clear button.** Once a
 * search is typed, a 48px `icon` square clears it, and the box beside it was
 * the 44px default. The box is `md` whether or not the clear button shows, so
 * it does not change height as the first letter is typed. Found by reading
 * the code (review of 2026-09-25).
 */
describe("the dive-site library's search row", () => {
  it("draws the search box at md, the 48px of the icon button that clears it", () => {
    expect(SEARCH_START, "the search box is where this test looks").toBeGreaterThan(-1);
    expect(SEARCH).toContain('id="site-search"');
    expect(SEARCH).toContain('size="md"');
  });
});
