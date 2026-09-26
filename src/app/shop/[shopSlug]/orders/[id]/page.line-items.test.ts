import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read, as `page.control-row.test.ts` is: the order page is a Server
 * Component behind the staff session, so this pins the source that decides
 * the geometry; nothing here measures it.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");
const LINE_ITEMS = SOURCE.slice(
  SOURCE.indexOf("{order.lineItems.map("),
  SOURCE.indexOf("</ul>", SOURCE.indexOf("{order.lineItems.map(")),
);

/**
 * **A line's price stands on the line that names the item** (pixel-craft
 * class 1; K-575). An item's description is free text and the only thing on
 * the row that wraps: "Blue Mantis rash guard (Merchandise)" needs about 300px
 * and the receipt's column is 286px at 360, so it runs to two lines, and a row
 * aligned `items-center` floated "$59.00" 10px below the first of them. Both
 * sides are `text-sm`, so on a baseline a one-line row renders as it did.
 */
describe("the receipt's line items", () => {
  it("set the price on the description's first line", () => {
    const row = LINE_ITEMS.match(/<li key=\{item\.id\} className="([^"]+)"/)?.[1] ?? "";
    expect(row.split(" ")).toContain("items-baseline");
    expect(row.split(" ")).not.toContain("items-center");
  });

  it("let the description shrink and wrap rather than push the price out", () => {
    const description = LINE_ITEMS.match(/<li[^>]*>\s*<span className="([^"]*)"/)?.[1] ?? "";
    expect(description.split(" ")).toContain("min-w-0");
  });
});
