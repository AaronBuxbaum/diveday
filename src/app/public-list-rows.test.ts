import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every literal `className="…"` in a file, split into its tokens. */
function classStrings(file: string): string[][] {
  const source = readFileSync(path.join(SRC, file), "utf8");
  return [...source.matchAll(/className="([^"]*)"/g)].map((match) => match[1].split(/\s+/));
}

/**
 * **A public list's hover fill spans rule to rule, square, with its words on
 * the column** (docs/design/pixel-craft.md, class 6; K-513).
 *
 * The regional index, a town's shops and a shop's course ladder each drew
 * their rows as a `-mx-3 rounded-lg px-3` link inside a `divide-y border-y`
 * list: the fill ran 12px past both ends of the rules above and below it, and
 * its 12px corners sat entirely outside the ruled band, so a hovered row read
 * as a pill that had slipped out of the list. They take the ledger's geometry
 * now (`FILL_ROOM` in src/components/ui/ledger.tsx): the list steps 8px out
 * (`-mx-2`), so its rules run with the fill; the row keeps the room as its own
 * `px-2`, so the words stay on the column; and the fill is square, because it
 * is the row between two rules and not a box of its own.
 */
const LISTS: readonly [page: string, skeleton: string][] = [
  ["app/dive/page.tsx", "app/dive/loading.tsx"],
  ["app/dive/[region]/page.tsx", "app/dive/[region]/loading.tsx"],
  ["app/s/[shopSlug]/courses/page.tsx", "app/s/[shopSlug]/courses/loading.tsx"],
];

describe("the public lists' rows", () => {
  it.each(LISTS)("%s steps its list out and keeps the row's words on the column", (page) => {
    const strings = classStrings(page);
    const lists = strings.filter((tokens) => tokens.includes("divide-y"));
    const rows = strings.filter((tokens) => tokens.includes("hover:bg-surface-sunken"));
    expect(lists).toHaveLength(1);
    expect(rows).toHaveLength(1);
    expect(lists[0]).toContain("-mx-2");
    expect(rows[0]).toContain("px-2");
    expect(rows[0]).not.toContain("-mx-3");
    expect(rows[0]).not.toContain("rounded-lg");
  });

  it.each(LISTS)("%s's skeleton draws its rules where the list's land", (_page, skeleton) => {
    const strings = classStrings(skeleton);
    const lists = strings.filter((tokens) => tokens.includes("divide-y"));
    const rows = strings.filter((tokens) => tokens.includes("py-5"));
    expect(lists).toHaveLength(1);
    expect(lists[0]).toContain("-mx-2");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toContain("px-2");
  });
});
