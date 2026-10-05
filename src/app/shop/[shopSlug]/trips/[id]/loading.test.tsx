// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import TripSurfaceLoading from "./loading";

afterEach(cleanup);

/**
 * **The departure's skeleton opens on the header the page opens on**
 * (pixel-craft class 11, K-197). It drew the retired masthead — three grey bars
 * in an `mb-8` — and a 28px roster heading the compact roster does not have, so
 * the About card dropped when the page landed. jsdom lays nothing out, so this
 * pins the shape; the header's own lines are `TripPageHeaderSkeleton`'s, exported
 * beside `TripPageHeader`, the header every tab of the departure wears.
 */
describe("the departure's loading frame", () => {
  it("starts with the header's own lines", () => {
    const { container } = render(<TripSurfaceLoading />);
    const first = container.firstElementChild?.firstElementChild;
    // The back link, the title and the date row, with no margin of its own:
    // the page's `space-y-10` spaces it.
    expect(first?.children).toHaveLength(3);
    expect(first?.className).toBe("");
    expect(first?.firstElementChild).toHaveClass("h-4");
  });

  it("draws no roster heading the compact roster does not have", () => {
    const { container } = render(<TripSurfaceLoading />);
    expect(container.querySelector(".h-7:not(.rounded-full)")).toBeNull();
    expect(container.querySelector("section")).toBeNull();
  });
});
