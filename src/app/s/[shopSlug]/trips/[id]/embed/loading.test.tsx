// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import TripDetailLoading from "../loading";
import EmbeddedTripLoading from "./loading";

afterEach(cleanup);

const source = (file: string) => readFileSync(join(__dirname, file), "utf8");

/**
 * The `<main>` the trip page wears in embed mode, read off the page: a server
 * page has no render to inspect without a database, a shop and a departure.
 */
const EMBED_FRAME = /isEmbed\s*\?\s*"([^"]+)"\s*:\s*"mx-auto/.exec(source("../page.tsx"))?.[1];

/**
 * The box `TripHeader` puts its header in, or that it puts it in none —
 * read off it, so a change to its margin that is not made here too goes red
 * rather than moving the title under a skeleton that still promises the old
 * place. Group 1 is the wrapper when there is one, group 2 its class.
 */
const TRIP_HEADER = /return \(\s*(<div(?: className="([^"]*)")?>\s*)?<ShopPageHeader/.exec(
  source("../_components/TripHeader.tsx"),
);

/** The header skeleton itself, inside the wrapper `TripHeader` has, if any. */
function headerSkeletonIn(container: HTMLElement): Element | null | undefined {
  const first = container.querySelector("main .animate-pulse")?.firstElementChild;
  return TRIP_HEADER?.[1] ? first?.firstElementChild : first;
}

/**
 * Everything from the day's run down, which the frame draws exactly as the
 * page does because it is the same page body: the boxes, and the stack they
 * stand in. The tiles are the one intended difference — the frame's are 4:3
 * boxes at its width — so their row is compared and its inside is not.
 */
function bodyBelowHeader(container: HTMLElement): { stack: string[]; run: string[] } {
  const day = container.querySelector(".h-28");
  const stack: string[] = [];
  for (
    let parent = day?.parentElement;
    parent && !parent.classList.contains("animate-pulse");
    parent = parent.parentElement
  ) {
    stack.push(parent.className);
  }
  const run: string[] = [];
  for (let block = day; block; block = block.nextElementSibling) {
    const copy = block.cloneNode(true) as Element;
    const rows = copy.matches(".grid-cols-3") ? [copy] : [...copy.querySelectorAll(".grid-cols-3")];
    for (const row of rows) row.innerHTML = "";
    run.push(copy.outerHTML);
  }
  return { stack, run };
}

/**
 * **The framed trip page loads in the frame's own shape** (K-382). Under the
 * trip page's segment a shop's framed booking widget first painted a centred
 * 528px column with a back-link bar, then snapped to a full-width column 12px
 * from the frame's edge and about 105px higher.
 */
describe("the framed trip page's skeleton", () => {
  it("is the frame's full-width column, never the page's max-w-xl one", () => {
    expect(EMBED_FRAME).toBeTruthy();
    const { container } = render(<EmbeddedTripLoading />);
    expect(container.querySelector("main")?.getAttribute("class")).toBe(EMBED_FRAME);
    expect(container.innerHTML).not.toContain("max-w-xl");
  });

  it("opens on TripHeader's own box, with no back-link bar above it", () => {
    expect(TRIP_HEADER).not.toBeNull();
    const { container } = render(<EmbeddedTripLoading />);
    const first = container.querySelector("main .animate-pulse")?.firstElementChild;
    if (TRIP_HEADER?.[1]) {
      expect(first?.getAttribute("class") ?? "").toBe(TRIP_HEADER[2] ?? "");
    }
    // The header skeleton itself, not a bar standing in for a link the frame
    // does not have.
    expect(headerSkeletonIn(container)?.classList.contains("mb-8")).toBe(true);
  });

  it("leads the header with the shop's own line, which the frame shows in place of the bar", () => {
    const { container } = render(<EmbeddedTripLoading />);
    expect(headerSkeletonIn(container)?.firstElementChild?.classList.contains("mb-5")).toBe(true);
  });

  it("stands its body on the page skeleton's own boxes, so restacking one restacks the other", () => {
    // The frame renders the trip page's body, so below the header the two
    // skeletons are one drawing. They are two copies because a segment's
    // skeleton cannot be told which column it is in; this is what holds them
    // together — a change to the page's section stack that is not made here
    // too goes red instead of landing the frame's sections off its skeleton.
    const page = bodyBelowHeader(render(<TripDetailLoading />).container);
    const frame = bodyBelowHeader(render(<EmbeddedTripLoading />).container);
    expect(page.run.length).toBeGreaterThan(0);
    expect(frame).toEqual(page);
  });

  it("draws the three field-guide tiles at their photographs' 4:3, which the full-width frame scales", () => {
    const { container } = render(<EmbeddedTripLoading />);
    expect(container.querySelectorAll(".grid-cols-3 > * > .aspect-\\[4\\/3\\]")).toHaveLength(3);
  });
});
