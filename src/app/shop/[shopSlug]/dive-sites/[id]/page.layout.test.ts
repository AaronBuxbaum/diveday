import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read: a dive site's page is a Server Component that needs a
 * database to render, so this pins the source that decides the geometry;
 * nothing here measures it.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");

/** The class string of the first `tag` opening after `from`. */
function classesAfter(from: number, tag: string): string[] {
  const start = SOURCE.indexOf(`<${tag}`, from);
  const match = SOURCE.slice(start).match(/className="([^"]*)"/);
  return match ? match[1].split(/\s+/) : [];
}

/**
 * **The upcoming dives start on the card's own column** (docs/design/
 * pixel-craft.md, class 3; K-412). The list bleeds to the card's edges by
 * undoing its padding, `-mx-4` and `sm:-mx-5`, so each row has to pad itself
 * back by the same amounts. It padded only `px-4`, so from 640px up every
 * departure's title started 4px left of "Upcoming dives here" above it and its
 * date ended 16px inside the card where the heading sits 20px in.
 */
describe("a dive site's upcoming dives", () => {
  it("pad each row back by exactly what the list bleeds, at every width", () => {
    const list = SOURCE.indexOf("{upcomingTrips.length > 0 ? (");
    expect(list, "the list is where this test looks").toBeGreaterThan(-1);
    const bleed = classesAfter(list, "ul").filter((token) => /^(\w+:)?-mx-/.test(token));
    const pad = classesAfter(SOURCE.indexOf("<Link", list), "Link").filter((token) =>
      /^(\w+:)?px-/.test(token),
    );
    expect(bleed.length).toBeGreaterThan(0);
    expect(pad.sort()).toEqual(bleed.map((token) => token.replace("-mx-", "px-")).sort());
  });
});
