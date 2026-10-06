// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import AboutLoading from "./loading";

afterEach(cleanup);

/**
 * **`/about`'s skeleton is the page it stands in for** (docs/design/pixel-craft.md,
 * class 11; K-394).
 *
 * The captain's phone was a guessed `h-[30rem]` bar, 480px, where the phone
 * `CaptainPhoneFrame` draws is 468px on a phone and 450px from `lg` (its
 * height is its mockup's, and the mockup wraps one line more in the 320px
 * `max-w-xs` column than in the 384px `lg:max-w-sm` one). From `lg` the phone
 * sets the hero's height, so everything under it dropped 30px on arrival.
 * The band under the hero is drawn as the band that lands there.
 */
describe("the /about skeleton", () => {
  it("draws the phone at the height the frame renders at each width", () => {
    const { container } = render(<AboutLoading />);
    const phone = container.querySelector("main .rounded-\\[2\\.5rem\\]");
    expect(phone).toHaveClass("h-[468px]", "lg:h-[450px]");
    expect(phone).not.toHaveClass("h-[30rem]");
  });

  it("draws the band that follows the hero, on the surface fill, with no button bars", () => {
    // The four rules and their demo/trial pair followed the hero until the
    // 2026-10-06 rewrite; the band on who is behind DiveDay does now, and it
    // has no controls, so a button-shaped bar here would be a jump on arrival.
    const { container } = render(<AboutLoading />);
    const sections = container.querySelectorAll("main > section");
    expect(sections).toHaveLength(2);
    expect(sections[1]).toHaveClass("bg-surface");
    expect(container.querySelectorAll("main .rounded-lg")).toHaveLength(0);
  });
});
