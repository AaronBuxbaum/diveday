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
  it("sits both bodies on the chrome's 24px gutter, as the pages do (K-293)", () => {
    for (const Skeleton of [RegionsLoading, RegionLoading]) {
      const { container } = render(<Skeleton />);
      const main = container.querySelector("main");
      expect(main).toHaveClass("px-6");
      expect(main).not.toHaveClass("px-4");
      cleanup();
    }
  });

  /**
   * "Dive shops by town" is about 344px of 40px type. The 24px gutter leaves
   * a 342px column on a 390px phone, which wraps it, and 345px or more from
   * 393px (iPhone 15 and 16, 16 Pro and Pro Max, 412px Android), which does
   * not. No one count serves both sides of 392px; the skeleton draws the one
   * line most phones land on, where a two-line bar dropped the page 44px on
   * every phone from 393 up.
   */
  it("draws the index's title on the one line a 393px-or-wider phone sets it on", () => {
    const { container } = render(<RegionsLoading />);
    const header = container.querySelector("main .animate-pulse");
    expect(header?.querySelectorAll(".h-11")).toHaveLength(1);
  });

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
