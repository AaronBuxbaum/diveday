// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WeekPager } from "./week-pager";

afterEach(cleanup);

const words = { previous: "Previous week", next: "Next week", thisWeek: "This week" };

describe("WeekPager", () => {
  it("wraps the row rather than breaking the range or the way back inside themselves", () => {
    // At 390 the row could not wrap, so the range shrank onto two lines and
    // "This week" broke after "This" (K-334). The row wraps now, and each of
    // the two words-bearing pieces stays whole: the link drops to a line of
    // its own instead.
    render(
      <WeekPager
        rangeLabel="Aug 24 – 30, 2026"
        previousHref="/shop/blue-mantis/schedule/board?week=2026-08-17"
        nextHref="/shop/blue-mantis/schedule/board?week=2026-08-31"
        thisWeekHref="/shop/blue-mantis/schedule/board"
        words={words}
      />,
    );
    const range = screen.getByText("Aug 24 – 30, 2026");
    expect(range.parentElement).toHaveClass("flex", "flex-wrap", "items-center");
    expect(range).toHaveClass("whitespace-nowrap");
    expect(screen.getByRole("link", { name: "This week" })).toHaveClass("whitespace-nowrap");
  });

  it("draws the way back at the arrows' height and type, one size per row", () => {
    // The arrows are `icon` (48px, 16px type); the link was `sm` (44px, 14px)
    // beside them (#1982). It is `md` now, which only fits at 390 because the
    // row above wraps as whole units.
    render(
      <WeekPager
        rangeLabel="Aug 24 – 30, 2026"
        previousHref="/a"
        nextHref="/b"
        thisWeekHref="/c"
        words={words}
      />,
    );
    const thisWeek = screen.getByRole("link", { name: "This week" });
    expect(thisWeek).toHaveClass("min-h-12", "text-base");
    expect(thisWeek).not.toHaveClass("text-sm");
    expect(screen.getByRole("link", { name: "Previous week" })).toHaveClass("min-h-12");
  });

  it("leaves the way back out while the current week is already on screen", () => {
    render(
      <WeekPager
        rangeLabel="Aug 24 – 30, 2026"
        previousHref="/a"
        nextHref="/b"
        thisWeekHref={null}
        words={words}
      />,
    );
    expect(screen.queryByRole("link", { name: "This week" })).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });
});
