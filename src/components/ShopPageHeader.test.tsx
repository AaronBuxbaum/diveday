// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ShopPageHeader, ShopPageHeaderSkeleton } from "./ShopPageHeader";

afterEach(cleanup);

describe("ShopPageHeader's title", () => {
  it("keeps a trip title's em dash off the start of a line", () => {
    // The title rung balances its wrap, and balancing broke at the space
    // before the dash on the public trip page at 390 (K-117).
    render(<ShopPageHeader title="Two-Tank Reef — Benwood & Elbow" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Two-Tank Reef\u00A0— Benwood & Elbow",
    );
  });
});

/**
 * **A skeleton says whether its page has a description.**
 *
 * The bar used to be on by default, and 49 of 57 loading files took the
 * default — including Settings, Security, Team and the course roster, whose
 * headers have no description at all. Every navigation into them painted a
 * 24px bar plus its 8px gap that the page never had, then dropped everything
 * below it 32px when the page landed (K-28). Required, so a new skeleton has
 * to answer the question rather than inherit the wrong answer.
 */
describe("the skeleton's description bar", () => {
  const descriptionBars = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("div")).filter((bar) => bar.classList.contains("h-6"));

  it("is drawn only when the page has a description", () => {
    const without = render(<ShopPageHeaderSkeleton description={false} />);
    expect(descriptionBars(without.container)).toHaveLength(0);
    without.unmount();

    const withOne = render(<ShopPageHeaderSkeleton description />);
    expect(descriptionBars(withOne.container)).toHaveLength(1);
  });

  it("has no default, so every loading file answers for its own page", () => {
    // @ts-expect-error — `description` is required.
    render(<ShopPageHeaderSkeleton />);
  });
});
