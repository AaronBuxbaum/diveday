import { describe, expect, it } from "vitest";
import {
  aggregateLabel,
  EMPTY_REVIEW_AGGREGATE,
  MAX_REVIEW_COMMENT_LENGTH,
  normalizeReviewComment,
  parseReviewRating,
  publishesImmediately,
  ratingLabel,
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
    expect(aggregateLabel(reviewAggregate(0, 0))).toBeNull();
  });

  it("averages to one decimal", () => {
    expect(reviewAggregate(3, 13)).toEqual({ count: 3, average: 4.3 });
    expect(reviewAggregate(4, 20)).toEqual({ count: 4, average: 5 });
  });

  it("shows a single review honestly instead of hiding a thin sample", () => {
    expect(reviewAggregate(1, 3)).toEqual({ count: 1, average: 3 });
    expect(aggregateLabel(reviewAggregate(1, 3))).toBe("3.0 out of 5 from 1 review");
  });

  it("never rounds a mixed record up to a clean five", () => {
    const aggregate = reviewAggregate(10, 49);
    expect(aggregate.average).toBe(4.9);
    expect(aggregateLabel(aggregate)).toBe("4.9 out of 5 from 10 reviews");
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

  it("falls back to a neutral byline rather than rendering a blank one", () => {
    expect(reviewerDisplayName("   ")).toBe("A diver");
  });
});

describe("ratingLabel", () => {
  it("spells the rating out, since a row of stars reads as nothing aloud", () => {
    expect(ratingLabel(4)).toBe("4 out of 5 stars");
  });
});
