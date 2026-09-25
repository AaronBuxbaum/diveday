import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The departure page is a Server Component over a dozen reads, so these read
 * its source rather than render it. They pin the page's composition, not the
 * behaviour of what it composes; that lives beside each component.
 */
const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");

describe("the departure page's packing-list anchor", () => {
  /**
   * The anchor wrapper renders on every departure so the skeleton holds the
   * position five links land on while the gear reads run. On a departure
   * nobody is booked on the packing list renders no node at all (see
   * `PrepBody.test.tsx`), and the pixel probe measured the wrapper 0px tall
   * and still holding its `mt-10` open: a 40px gap where siblings sit 20px
   * apart (trip-repeating-cadence, trip-repeating-panel). React's Suspense
   * markers are comments, which `:empty` ignores, so `empty:hidden` takes the
   * wrapper out of the flow exactly when the list says nothing, and never
   * while the skeleton or a read-failure banner is in it.
   */
  it("carries empty:hidden, and holds nothing but the Suspense boundary that may resolve to nothing", () => {
    const open = SOURCE.indexOf("<div id={PREP_SECTION_ID}");
    expect(open).toBeGreaterThan(-1);
    const tagEnd = SOURCE.indexOf(">", open);
    const tag = SOURCE.slice(open, tagEnd + 1);
    expect(tag).toMatch(/className="[^"]*\bempty:hidden\b[^"]*"/);

    const close = SOURCE.indexOf("</div>", tagEnd);
    const inside = SOURCE.slice(tagEnd + 1, close).trim();
    expect(inside.startsWith("<Suspense")).toBe(true);
    expect(inside.endsWith("</Suspense>")).toBe(true);
  });
});
