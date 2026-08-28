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
    expect(
      screen.getByText("4.3 average across 83 published reviews · this month 4.6 from 12 reviews"),
    ).toBeInTheDocument();
    // One occurrence of the shop's average, not one per clause.
    expect(screen.queryAllByText(/4\.3 average/)).toHaveLength(1);
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
