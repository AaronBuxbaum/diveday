// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ShopStatSkeleton } from "@/components/ShopPageHeader";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { TripPageHeaderSkeleton } from "../../_components/TripPageHeader";
import TripPrepLoading from "../loading";
import { PrepBodySkeleton } from "./PrepBodySkeleton";

afterEach(cleanup);

/** The skeleton's Tanks block: the first section of its stack. */
function tanks() {
  return render(<PrepBodySkeleton className="space-y-10" />).container.firstElementChild
    ?.firstElementChild;
}

/**
 * **The packing list's skeleton is the list's own top** (K-188). It predated
 * the per-dive basis line and the tiles' `grid-cols-3`: a heading bar short of
 * the heading with no basis line under it, and three `h-28` boxes in
 * `sm:grid-cols-3`, stacked 360px tall below 640px where the list draws one
 * 98px row. On the departure page that collapse came after a jump to
 * `#packing-list`.
 */
describe("PrepBodySkeleton", () => {
  it("stands a heading line, then the per-dive basis line, then the tiles", () => {
    const [heading, basis, tiles] = Array.from(tanks()?.children ?? []);
    // The line box of the heading it stands in for, read off the list's tanks
    // section (`PrepTanks`, which `PrepBody` draws first), so a
    // change to the list's section titles that is not made here goes red.
    const list = readFileSync(join(__dirname, "PrepTanks.tsx"), "utf8");
    expect(list).toMatch(
      /id=\{scopedId\(idPrefix, "tanks-heading"\)\} className=\{SECTION_TITLE_CLASS\}/,
    );
    expect(heading).toHaveClass("h-lh", ...SECTION_TITLE_CLASS.split(" "));
    // `PrepBody`'s `mt-1 text-sm` line: two lines on a phone, one from `sm`.
    expect(basis).toHaveClass("mt-1");
    expect(basis.children).toHaveLength(2);
    for (const line of Array.from(basis.children)) expect(line).toHaveClass("h-5");
    expect(basis.children[1]).toHaveClass("sm:hidden");
    expect(tiles).toHaveClass("mt-3", "grid", "gap-3", "grid-cols-3");
  });

  it("draws the tank tiles three across at every width, each the stat tile's own shape", () => {
    const tiles = tanks()?.children[2];
    expect(tiles?.className).not.toMatch(/(?:^|\s)sm:grid-cols-/);
    expect(tiles?.children).toHaveLength(3);
    const tile = render(<ShopStatSkeleton />).container.firstElementChild?.outerHTML;
    for (const child of Array.from(tiles?.children ?? [])) expect(child.outerHTML).toBe(tile);
  });

  it("stacks its sections at the gap its caller hands the list, with no margin of their own", () => {
    const body = render(<PrepBodySkeleton className="space-y-10" />).container.firstElementChild;
    expect(body).toHaveClass("space-y-10");
    for (const section of Array.from(body?.children ?? [])) {
      expect(section.className).not.toMatch(/(?:^|\s)m[ty]-/);
    }
  });
});

describe("the prep route's loading state", () => {
  it("stands in for the header the page wears, not ShopPageHeader's", () => {
    // An eyebrow bar and no description bar: the page's `TripPageHeader` has
    // its way back and no description line.
    const loading = render(<TripPrepLoading />).container.innerHTML;
    const header = render(<TripPageHeaderSkeleton titleLines={{ base: 2, sm: 1 }} />).container
      .innerHTML;
    expect(loading).toContain(header);
    expect(loading).toContain(
      render(<PrepBodySkeleton className="space-y-10" />).container.innerHTML,
    );
  });
});
