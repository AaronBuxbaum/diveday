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
