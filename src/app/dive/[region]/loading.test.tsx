// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import RegionsLoading from "../loading";
import RegionLoading from "./loading";

afterEach(cleanup);

/**
 * **The `/dive` skeletons are the pages they stand in for** (K-292).
 *
 * `/dive/[region]` drew a 56px logo square on every row, and the page draws a
 * logo only for a shop that uploaded one — the common case is none, so every
 * row's words started 72px right of where they land. And both headers wrap
 * on a phone: the index's description to three lines (two from `sm`), the
 * town's title and description to two each (one from `sm`), where the
 * skeletons drew one of each.
 */
describe("the /dive skeletons", () => {
  it("draws no logo square on a town's shop rows", () => {
    const { container } = render(<RegionLoading />);
    expect(container.querySelector(".size-14")).toBeNull();
  });

  it("wraps the town's title and description to two lines below sm", () => {
    const { container } = render(<RegionLoading />);
    const header = container.querySelector("main .animate-pulse");
    const phoneOnly = Array.from(header?.querySelectorAll(".sm\\:hidden") ?? []);
    expect(
      phoneOnly.map((line) => (line.classList.contains("h-11") ? "title" : "description")),
    ).toEqual(["title", "description"]);
  });

  it("wraps the index's description to three lines below sm and two from it", () => {
    const { container } = render(<RegionsLoading />);
    const header = container.querySelector("main .animate-pulse");
    const lines = Array.from(header?.querySelectorAll(".h-6") ?? []);
    expect(lines).toHaveLength(3);
    expect(lines.filter((line) => line.classList.contains("sm:hidden"))).toHaveLength(1);
  });
});
