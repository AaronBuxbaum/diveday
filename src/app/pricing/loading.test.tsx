// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PricingLoading from "./loading";

afterEach(cleanup);

/** The hero section's column: the first `<section>` of the skeleton's `<main>`. */
function heroColumn() {
  const column = screen.getByRole("main").querySelector("section > div");
  if (!column) throw new Error("no hero column");
  return column;
}

/**
 * **The pricing skeleton is the hero the page lands** (docs/design/
 * pixel-craft.md, class 11; K-408). It predated the annotated invoice (the
 * 2026-09-24 voice decision) and still drew the older order — figure, lede,
 * doors, list — on a narrower measure, so the doors painted where the invoice
 * lands and dropped 425px when it arrived, and the figure bar was 16px short
 * of the 72/96px figure.
 */
describe("the pricing skeleton", () => {
  it("stands on the page's measure", () => {
    render(<PricingLoading />);
    expect(heroColumn()).toHaveClass("max-w-4xl");
    expect(heroColumn()).not.toHaveClass("max-w-3xl");
  });

  it("draws the invoice's eight 48px lines before the doors", () => {
    render(<PricingLoading />);
    const ledger = heroColumn().querySelector(".divide-y");
    expect(ledger?.children).toHaveLength(8);
    for (const row of ledger?.children ?? []) expect(row).toHaveClass("py-3");
    const door = heroColumn().querySelector(".h-12.rounded-lg");
    expect(door).not.toBeNull();
    expect(
      ledger && door ? ledger.compareDocumentPosition(door) & Node.DOCUMENT_POSITION_FOLLOWING : 0,
    ).toBeTruthy();
  });

  it("draws the figure at its 72px phone and 96px desk line", () => {
    render(<PricingLoading />);
    expect(heroColumn().querySelector(".h-18")).toHaveClass("sm:h-24");
  });
});
