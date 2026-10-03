// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import TripDetailLoading from "./loading";

afterEach(cleanup);

/**
 * **The trip's skeleton opens where the page does** (docs/design/
 * pixel-craft.md, class 11: 0px of shift on load; K-264). It still drew the
 * standalone "← All trips" bar the page dropped when its header's eyebrow
 * became the way back, so the title landed 16px higher than its grey bar; and
 * it drew nothing for the Add-to-calendar / Share row under the hero, so
 * everything below arrived 60px lower.
 */
describe("the public trip's loading skeleton", () => {
  it("opens on the header, with no bar for a back link the page no longer has", () => {
    const { container } = render(<TripDetailLoading />);
    // The hero is the grid's first cell (two columns from `lg`), and opens on
    // `ShopPageHeaderSkeleton`'s own wrapper, with the eyebrow bar inside it.
    const hero = container.querySelector(".animate-pulse")?.firstElementChild;
    expect(hero?.firstElementChild).toHaveClass("mb-8");
  });

  it("stands the hero's actions row, 44px, under the header", () => {
    const { container } = render(<TripDetailLoading />);
    const actions = container.querySelector(".animate-pulse")?.firstElementChild?.children[1];
    expect(actions).toHaveClass("mt-4", "h-11");
  });
});
