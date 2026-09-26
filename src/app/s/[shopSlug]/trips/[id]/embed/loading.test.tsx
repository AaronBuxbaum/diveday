// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import EmbeddedTripLoading from "./loading";

afterEach(cleanup);

const source = (file: string) => readFileSync(join(__dirname, file), "utf8");

/**
 * The `<main>` the trip page wears in embed mode, read off the page: a server
 * page has no render to inspect without a database, a shop and a departure.
 */
const EMBED_FRAME = /isEmbed\s*\?\s*"([^"]+)"\s*:\s*"mx-auto/.exec(source("../page.tsx"))?.[1];

/**
 * The box `TripHeader` puts its header in — read off it, so a change to its
 * margin that is not made here too goes red rather than moving the title
 * under a skeleton that still promises the old place.
 */
const HEADER_WRAPPER = /return \(\s*<div(?: className="([^"]*)")?>\s*<ShopPageHeader/.exec(
  source("../_components/TripHeader.tsx"),
);

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
    expect(HEADER_WRAPPER).not.toBeNull();
    const { container } = render(<EmbeddedTripLoading />);
    const header = container.querySelector("main .animate-pulse")?.firstElementChild;
    expect(header?.getAttribute("class") ?? "").toBe(HEADER_WRAPPER?.[1] ?? "");
    // The header skeleton itself, not a bar standing in for a link the frame
    // does not have.
    expect(header?.firstElementChild?.classList.contains("mb-8")).toBe(true);
  });

  it("leads the header with the shop's own line, which the frame shows in place of the bar", () => {
    const { container } = render(<EmbeddedTripLoading />);
    const headerSkeleton =
      container.querySelector("main .animate-pulse")?.firstElementChild?.firstElementChild;
    expect(headerSkeleton?.firstElementChild?.classList.contains("mb-5")).toBe(true);
  });

  it("draws the three field-guide tiles at their photographs' 4:3, which the full-width frame scales", () => {
    const { container } = render(<EmbeddedTripLoading />);
    expect(container.querySelectorAll(".grid-cols-3 > * > .aspect-\\[4\\/3\\]")).toHaveLength(3);
  });
});
