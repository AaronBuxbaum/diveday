import { describe, expect, it } from "vitest";
import {
  EMPTY_REVIEW_AGGREGATE,
  MAX_REVIEW_COMMENT_LENGTH,
  normalizeReviewComment,
  parseReviewRating,
  publishesImmediately,
  ratingIsRepresentative,
  reviewAggregate,
  reviewerDisplayName,
} from "./reviews";

describe("parseReviewRating", () => {
  it("accepts the five ratings a diver can actually pick", () => {
    for (const value of ["1", "2", "3", "4", "5"]) {
      expect(parseReviewRating(value)).toBe(Number(value));
    }
  });

  it("refuses anything off the scale rather than clamping it", () => {
    for (const value of ["0", "6", "-1", "99"]) {
      expect(parseReviewRating(value)).toBeNull();
    }
  });

  it("refuses fractional, empty, and non-numeric input instead of coercing to 0", () => {
    for (const value of ["4.5", "", "   ", "four", null, undefined, {}]) {
      expect(parseReviewRating(value)).toBeNull();
    }
  });
});

describe("normalizeReviewComment", () => {
  it("keeps a diver's words, trimmed and with runs of whitespace collapsed", () => {
    expect(normalizeReviewComment("  Great   crew,\n\nvis was unreal  ")).toBe(
      "Great crew, vis was unreal",
    );
  });

  it("reads whitespace-only and non-strings as no comment at all", () => {
    for (const value of ["", "   ", "\n\t", null, undefined, 5]) {
      expect(normalizeReviewComment(value)).toBeNull();
    }
  });

  it("truncates past the server bound — the write path is public, so this is the real cap", () => {
    const comment = normalizeReviewComment("x".repeat(MAX_REVIEW_COMMENT_LENGTH + 200));
    expect(comment).toHaveLength(MAX_REVIEW_COMMENT_LENGTH);
  });
});

describe("publishesImmediately", () => {
  it("publishes a bare rating — there is no text to moderate", () => {
    expect(publishesImmediately(null)).toBe(true);
  });

  it("holds a review carrying words until staff have read them", () => {
    expect(publishesImmediately("Best day of the trip")).toBe(false);
  });
});

describe("reviewAggregate", () => {
  it("reports no average at all when nothing is published, rather than 0", () => {
    expect(reviewAggregate(0, 0)).toEqual(EMPTY_REVIEW_AGGREGATE);
    expect(reviewAggregate(0, 0).average).toBeNull();
  });

  it("averages to one decimal", () => {
    expect(reviewAggregate(3, 13)).toEqual({ count: 3, average: 4.3, suppressedCount: 0 });
    expect(reviewAggregate(4, 20)).toEqual({ count: 4, average: 5, suppressedCount: 0 });
  });

  it("shows a single review honestly instead of hiding a thin sample", () => {
    expect(reviewAggregate(1, 3)).toEqual({ count: 1, average: 3, suppressedCount: 0 });
  });

  it("never rounds a mixed record up to a clean five", () => {
    expect(reviewAggregate(10, 49).average).toBe(4.9);
  });
});

describe("reviewerDisplayName", () => {
  it("signs a review with a first name and last initial, never the full name", () => {
    expect(reviewerDisplayName("Marta Reyes")).toBe("Marta R.");
    expect(reviewerDisplayName("  jo   van der berg ")).toBe("jo B.");
  });

  it("leaves a single-word name alone", () => {
    expect(reviewerDisplayName("Kai")).toBe("Kai");
  });

  it("reports an absent name as absence, never words — the surface picks the byline", () => {
    expect(reviewerDisplayName("   ")).toBe("");
  });
});

/**
 * The line between "a shop tidying its page" and "a curated set published as a
 * measurement" (ADR 20260813-review-moderation-has-a-floor). Above it, DiveDay
 * stops emitting `aggregateRating` — the shop's own stars stay on its own page.
 */
describe("ratingIsRepresentative", () => {
  const aggregate = (count: number, suppressedCount: number) => ({
    count,
    average: 5,
    suppressedCount,
  });

  it("stands behind a record with nothing taken down", () => {
    expect(ratingIsRepresentative(aggregate(12, 0))).toBe(true);
  });

  it("stands behind one removal in ten — the spam and the wrong-boat review", () => {
    expect(ratingIsRepresentative(aggregate(9, 1))).toBe(true);
  });

  it("refuses a 5.0 that had every unflattering verdict taken out from under it", () => {
    expect(ratingIsRepresentative(aggregate(6, 6))).toBe(false);
  });

  it("counts the share of what was judged, not of what survived", () => {
    // 4 published + 1 hidden is one in five, exactly at the line and allowed;
    // one more removal is over it. The denominator is every review the shop
    // ruled on, or a shop could dilute its own suppression by publishing more.
    expect(ratingIsRepresentative(aggregate(4, 1))).toBe(true);
    expect(ratingIsRepresentative(aggregate(4, 2))).toBe(false);
  });

  it("says no when there is nothing to describe", () => {
    expect(ratingIsRepresentative(aggregate(0, 0))).toBe(false);
  });

  it("says no for a shop whose every review is hidden", () => {
    expect(ratingIsRepresentative({ count: 0, average: null, suppressedCount: 3 })).toBe(false);
  });
});
