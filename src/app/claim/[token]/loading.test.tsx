// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ClaimLoading from "./loading";

afterEach(cleanup);

/**
 * **The claim skeleton is the claim page** (K-224): the shop's eyebrow, a
 * title that wraps, the date line under it, and one card. It drew two stacked
 * panels where the page has one card, no date line, and a one-line title, so
 * its first panel stood at y 132 where the card lands at 204 (1280).
 */
describe("the seat claim's skeleton", () => {
  it("draws one card, not two", () => {
    const { container } = render(<ClaimLoading />);
    expect(container.querySelectorAll(".rounded-panel")).toHaveLength(1);
  });

  it("puts the date line under the title and the card mt-8 below it, as the page does", () => {
    const { container } = render(<ClaimLoading />);
    const card = container.querySelector(".rounded-panel");
    const meta = card?.previousElementSibling;
    expect(meta).toHaveClass("mt-1", "h-6");
    expect(card).toHaveClass("mt-8");
  });

  it("wraps the title to three lines on a phone and two from sm", () => {
    // "A seat on Two-Tank Reef — Molasses & French is waiting for you" at
    // `text-3xl`: three lines in 350px, two in the column's 528.
    const { container } = render(<ClaimLoading />);
    const lines = Array.from(container.querySelectorAll(".h-9"));
    expect(lines).toHaveLength(3);
    expect(lines.filter((line) => line.classList.contains("sm:hidden"))).toHaveLength(1);
  });
});
