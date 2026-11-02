import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **No page under `/settings` is an ungated reader (issue #2739), and the
 * frame is not the gate.** `settings/layout.tsx` draws the rail only; a
 * redirect there would beat the page's own and replace its reason ("Billing is
 * limited to the owner") with the generic one. So each page names its gate
 * itself: an `allow:` in `page.tsx` or in a sibling module it renders through.
 */
const ROOT = new URL(".", import.meta.url).pathname;

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === "page.tsx" ? [path] : [];
  });
}

const sources = (dir: string) =>
  readdirSync(dir)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
    .map((f) => readFileSync(join(dir, f), "utf8"));

describe("every settings page names its own gate", () => {
  it.each(pages(ROOT).map((p) => relative(ROOT, p)))("%s", (page) => {
    const dir = join(ROOT, page, "..");
    // The hub renders through `SettingsPage.tsx`, which sits beside the layout.
    const pool = [...sources(dir), ...(page === "page.tsx" ? sources(ROOT) : [])];
    expect(pool.some((source) => source.includes("allow:"))).toBe(true);
  });
});
