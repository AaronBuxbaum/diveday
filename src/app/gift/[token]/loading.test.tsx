// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import GiftLoading from "./loading";

afterEach(cleanup);

/**
 * **The giver's skeleton is the giver's page** (K-224): the shop's eyebrow,
 * "{name}'s seat" on one line, the date line under it, and one card. Without
 * the date line and with `mt-6` its panel stood at y 132 where the card lands
 * at 168 (1280).
 */
describe("the gift giver's skeleton", () => {
  it("puts the date line under the title and one card mt-8 below it, as the page does", () => {
    const { container } = render(<GiftLoading />);
    const cards = container.querySelectorAll(".rounded-panel");
    expect(cards).toHaveLength(1);
    const meta = cards[0]?.previousElementSibling;
    expect(meta).toHaveClass("mt-1", "h-6");
    expect(cards[0]).toHaveClass("mt-8");
  });
});
