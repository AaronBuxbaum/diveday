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
 * pins the shape; the header's own lines are `VoyageHeaderSkeleton`'s, exported
 * beside `VoyageHeader`.
 */
describe("the departure's loading frame", () => {
  it("starts with the header's own lines", () => {
    const { container } = render(<TripSurfaceLoading />);
    const first = container.firstElementChild?.firstElementChild;
    expect(first?.tagName).toBe("HEADER");
    // The back row, the hour, the title and the facts line.
    expect(first?.children).toHaveLength(4);
    expect(first?.firstElementChild).toHaveClass("h-11");
  });

  it("draws no roster heading the compact roster does not have", () => {
    const { container } = render(<TripSurfaceLoading />);
    expect(container.querySelector(".h-7")).toBeNull();
    expect(container.querySelector("section")).toBeNull();
  });
});
