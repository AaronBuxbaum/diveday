import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PAGE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "page.tsx"),
  "utf8",
);

/**
 * **An edge has one rule** (docs/design/pixel-craft.md, class 6; K-294).
 *
 * The landing's export inventory is a hairline list, and the band it closes
 * ends on a full-width rule above the switching door. From `lg` the two sit in
 * different columns, 400px apart. Below `lg` the list stacks last, so its own
 * bottom rule and the band's rule ran 48px apart across the same column, with
 * nothing between them: an empty fifth row. The list draws its bottom rule
 * only from `lg`; on a phone the band's rule is its end.
 */
describe("the landing's export inventory", () => {
  it("closes with its own rule only beside the import mockup, from lg", () => {
    const list = PAGE.match(/<ul className="([^"]*)">\s*\{exportInventory\.map/);
    expect(list).not.toBeNull();
    const tokens = list?.[1].split(/\s+/) ?? [];
    expect(tokens).toContain("border-t");
    expect(tokens).toContain("lg:border-b");
    expect(tokens).not.toContain("border-y");
  });
});
