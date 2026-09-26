// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import TripSurfaceLoading from "./loading";

afterEach(cleanup);

/**
 * **The departure's skeleton opens on the band the page opens on** (pixel-craft
 * class 11, K-197). It drew the retired masthead — three grey bars on the page
 * ground in an `mb-8` — and a 28px roster heading the compact roster does not
 * have, so when the page landed a full-width sky arrived above the bars and the
 * About card dropped 171px at 1280. jsdom lays nothing out, so this pins the
 * shape; the band's own box is shared with `VoyageHeader` (its test holds that
 * half), and the eyes are a throttled navigation at 390 and 1280.
 */
describe("the departure's loading frame", () => {
  it("starts with a band of the sky's box, edge to edge and eating the shell's top padding", () => {
    const { container } = render(<TripSurfaceLoading />);
    const first = container.firstElementChild?.firstElementChild;
    expect(first?.tagName).toBe("HEADER");
    expect(first?.firstElementChild).toHaveClass(
      "w-screen",
      "mx-[calc(50%-50vw)]",
      "-mt-8",
      "sm:-mt-10",
      "pt-5",
      "pb-5",
      "sm:pt-7",
    );
  });

  it("draws no roster heading the compact roster does not have", () => {
    const { container } = render(<TripSurfaceLoading />);
    expect(container.querySelector(".h-7")).toBeNull();
    expect(container.querySelector("section")).toBeNull();
  });
});
