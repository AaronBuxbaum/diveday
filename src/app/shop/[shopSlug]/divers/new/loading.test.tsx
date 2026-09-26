// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FieldActions, FieldGrid } from "@/components/ui/form";
import NewDiverLoading from "./loading";

afterEach(cleanup);

/** The class tokens a real component renders, so the skeleton is held to them. */
function tokensOf(element: Element | null | undefined): string[] {
  return [...(element?.classList ?? [])];
}

/**
 * **The new-diver skeleton is the form it stands in for** (docs/design/
 * pixel-craft.md, class 11: 0px of shift on load). It drew the three fields
 * stacked at every width under a card 8px lower than the page's, and one 44px
 * bar where the page has two 48px buttons, so at 1280 the card changed shape
 * the moment the form arrived: one column of three became one row of three
 * (K-304). It now lays its bars on the form's own grid and action row.
 */
describe("the new-diver loading skeleton", () => {
  it("draws no description bar, since the page's header has none", () => {
    const { container } = render(<NewDiverLoading />);
    expect(container.querySelector(".h-6")).toBeNull();
  });

  it("opens its card at the page's own `mt-6`", () => {
    const { container } = render(<NewDiverLoading />);
    const card = container.querySelector(".rounded-panel");
    expect(card).toHaveClass("mt-6");
    expect(card).not.toHaveClass("mt-8");
  });

  it("lays the three fields on the name/email/phone trio's three-up grid", () => {
    const grid = tokensOf(render(<FieldGrid columns={3}>x</FieldGrid>).container.firstElementChild);
    cleanup();
    const { container } = render(<NewDiverLoading />);
    const skeletonGrid = container.querySelector(".rounded-panel")?.firstElementChild;
    expect(skeletonGrid).toHaveClass(...grid);
    expect(skeletonGrid).toHaveClass("sm:grid-cols-3");
    // Three field slots, then the action row.
    expect(skeletonGrid?.children).toHaveLength(4);
  });

  it("stands in for the two md buttons with two 48px bars on the form's action row", () => {
    const row = tokensOf(render(<FieldActions>x</FieldActions>).container.firstElementChild);
    cleanup();
    const { container } = render(<NewDiverLoading />);
    const actions = container.querySelector(".rounded-panel")?.firstElementChild?.lastElementChild;
    expect(actions).toHaveClass(...row);
    const bars = [...(actions?.children ?? [])];
    expect(bars).toHaveLength(2);
    for (const bar of bars) expect(bar).toHaveClass("h-12");
  });
});
