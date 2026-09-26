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
 * And the demo/trial pair was drawn at `h-11` under a comment that named
 * `buttonClass`'s `md` height, which is 48px.
 */
describe("the /about skeleton", () => {
  it("draws the phone at the height the frame renders at each width", () => {
    const { container } = render(<AboutLoading />);
    const phone = container.querySelector("main .rounded-\\[2\\.5rem\\]");
    expect(phone).toHaveClass("h-[468px]", "lg:h-[450px]");
    expect(phone).not.toHaveClass("h-[30rem]");
  });

  it("draws the demo/trial pair at the md button's 48px", () => {
    const { container } = render(<AboutLoading />);
    const bars = [...container.querySelectorAll("main .rounded-lg")];
    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      expect(bar).toHaveClass("h-12");
      expect(bar).not.toHaveClass("h-11");
    }
  });
});
