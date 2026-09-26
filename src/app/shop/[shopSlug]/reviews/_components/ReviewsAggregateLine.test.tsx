// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { ReviewAggregate } from "@/lib/reviews";
import { ReviewsAggregateLine } from "./ReviewsAggregateLine";

afterEach(cleanup);

const t = staffTranslator("en-US");

const NOTHING: ReviewAggregate = { count: 0, average: null, suppressedCount: 0 };

function aggregate(count: number, average: number, suppressedCount = 0): ReviewAggregate {
  return { count, average, suppressedCount };
}

function line(all: ReviewAggregate, month: ReviewAggregate = NOTHING) {
  return render(<ReviewsAggregateLine aggregate={all} month={month} t={t} />);
}

/**
 * **The page says how the shop is rated exactly once** (ADR
 * 20260827-people-not-lists, decision 3). Four stat tiles collapsed into this
 * line, and the regression it guards against is a second rating rendering
 * arriving beside it — a "Public rating" tile above a line that states the
 * same average is the same fact at two volumes.
 */
describe("the aggregate line", () => {
  it("states the average and the count once, in one line", () => {
    const { container } = line(aggregate(83, 4.34), aggregate(12, 4.6));
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector("p")?.textContent?.replace(/\s+/g, " ")).toBe(
      "4.3 average across 83 published reviews · this month 4.6 from 12 reviews",
    );
    // One occurrence of the shop's average, not one per clause.
    expect(screen.queryAllByText(/4\.3 average/)).toHaveLength(1);
  });

  /**
   * **The line breaks at its separator, never inside a clause** (pixel-craft
   * class 8, K-249). One string gave every space a break, and at 390 the line
   * wrapped after "· this month", so the first line read as the month's
   * reading of 83 reviews. Each clause keeps together while it fits a line,
   * and wraps inside itself only when it cannot — never off a narrow screen.
   */
  it("keeps each clause whole, so the line can only break after the dot", () => {
    const { container } = line(aggregate(83, 4.34), aggregate(12, 4.6));
    const paragraph = container.querySelector("p");
    const clauses = [...(paragraph?.children ?? [])];
    expect(clauses.map((clause) => clause.textContent)).toEqual([
      "4.3 average across 83 published reviews",
      "this month 4.6 from 12 reviews",
    ]);
    for (const clause of clauses) expect(clause).toHaveClass("inline-block");
    // The dot is glued to the clause before it, so no line opens on "·".
    expect(paragraph?.textContent).toContain("reviews\u00A0· this month");
  });

  it("says nothing about a month that has none", () => {
    line(aggregate(83, 4.34));
    expect(screen.getByText("4.3 average across 83 published reviews")).toBeInTheDocument();
    expect(screen.queryByText(/this month/)).toBeNull();
  });

  /**
   * An average of no reviews is not a low score. The tiles used to render "—"
   * under "Public rating"; a figure a reader has to decode is worse than the
   * empty state that speaks instead.
   */
  it("renders nothing at all before anything is published", () => {
    const { container } = line(NOTHING, NOTHING);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when a count exists but no average can be taken", () => {
    const { container } = line({ count: 4, average: null, suppressedCount: 0 });
    expect(container).toBeEmptyDOMElement();
  });

  /**
   * The suppression floor's arithmetic is a behavior contract this slice does
   * not touch (ADR 20260813-review-moderation-has-a-floor): a hidden review is
   * still counted, and it is still counted *out* of the published average this
   * line states.
   */
  it("states the published average, never one that quietly includes what was hidden", () => {
    line(aggregate(4, 5, 6));
    expect(screen.getByText("5.0 average across 4 published reviews")).toBeInTheDocument();
    expect(screen.queryByText(/10/)).toBeNull();
  });
});
