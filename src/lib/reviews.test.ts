import { describe, expect, it } from "vitest";
import {
  comparePublicReviews,
  EMPTY_REVIEW_AGGREGATE,
  MAX_REVIEW_COMMENT_LENGTH,
  normalizeReviewComment,
  parseReviewRating,
  publishesImmediately,
  ratingIsRepresentative,
  ratingIsWithheld,
  reviewAggregate,
  reviewerDisplayName,
  reviewsToRepublishForRating,
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

describe("comparePublicReviews", () => {
  const review = (
    input: Partial<{ isStandout: boolean; rating: number; publishedAt: string }> = {},
  ) => ({
    isStandout: false,
    rating: 4,
    ...input,
    publishedAt: new Date(input.publishedAt ?? "2026-01-01T00:00:00.000Z"),
  });

  it("puts standouts first and newest within the standout bucket", () => {
    expect(
      comparePublicReviews(
        review({ isStandout: true, rating: 3, publishedAt: "2026-01-01T00:00:00.000Z" }),
        review({ isStandout: false, rating: 5, publishedAt: "2026-01-04T00:00:00.000Z" }),
      ),
    ).toBeLessThan(0);
    expect(
      comparePublicReviews(
        review({ isStandout: true, rating: 3, publishedAt: "2026-01-02T00:00:00.000Z" }),
        review({ isStandout: true, rating: 5, publishedAt: "2026-01-01T00:00:00.000Z" }),
      ),
    ).toBeLessThan(0);
  });

  it("uses rating buckets, then newest, for non-standouts", () => {
    expect(
      comparePublicReviews(
        review({ rating: 5, publishedAt: "2026-01-01T00:00:00.000Z" }),
        review({ rating: 4, publishedAt: "2026-01-04T00:00:00.000Z" }),
      ),
    ).toBeLessThan(0);
    expect(
      comparePublicReviews(
        review({ rating: 4, publishedAt: "2026-01-04T00:00:00.000Z" }),
        review({ rating: 4, publishedAt: "2026-01-01T00:00:00.000Z" }),
      ),
    ).toBeLessThan(0);
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
    // 16 published + 4 hidden is one in five, exactly at the line and allowed;
    // one more removal is over it. The denominator is every review the shop
    // ruled on, or a shop could dilute its own suppression by publishing more.
    expect(ratingIsRepresentative(aggregate(16, 4))).toBe(true);
    expect(ratingIsRepresentative(aggregate(15, 5))).toBe(false);
  });

  it("says no when there is nothing to describe", () => {
    expect(ratingIsRepresentative(aggregate(0, 0))).toBe(false);
  });

  it("says no for a shop whose every review is hidden", () => {
    expect(ratingIsRepresentative({ count: 0, average: null, suppressedCount: 3 })).toBe(false);
  });

  /**
   * The small-sample floor. A ratio over three reviews describes whoever
   * happened to write them, not how a shop moderates, so the rule waits until
   * it has ten judged reviews to describe.
   */
  describe("below the small-sample floor", () => {
    it("leaves a young shop's rating alone when it removes the one piece of spam it got", () => {
      // 2 of 3 judged is 67% — far over the share, and meaningless at this size.
      expect(ratingIsRepresentative(aggregate(1, 2))).toBe(true);
      expect(ratingIsRepresentative(aggregate(4, 2))).toBe(true);
    });

    it("starts judging at the tenth review the shop has ruled on", () => {
      // 9 judged: unconstrained. 10 judged with the same 3 hidden: over the
      // share, and now large enough for the share to mean something.
      expect(ratingIsRepresentative(aggregate(6, 3))).toBe(true);
      expect(ratingIsRepresentative(aggregate(7, 3))).toBe(false);
    });

    it("still says no to a shop below the floor with nothing published at all", () => {
      // The floor forgives a share, never an absent average — three hidden
      // reviews and no published one is not a rating to stand behind.
      expect(ratingIsRepresentative({ count: 0, average: null, suppressedCount: 3 })).toBe(false);
    });
  });
});

describe("ratingIsWithheld", () => {
  it("separates a curated record from a shop that simply has no reviews", () => {
    // Both are "not representative"; only the first is something the shop did
    // and can undo, and only the first gets a warning on the Reviews page.
    expect(ratingIsWithheld({ count: 7, average: 5, suppressedCount: 3 })).toBe(true);
    expect(ratingIsWithheld({ count: 0, average: null, suppressedCount: 0 })).toBe(false);
  });

  it("says nothing is withheld from a shop under the floor", () => {
    expect(ratingIsWithheld({ count: 4, average: 5, suppressedCount: 2 })).toBe(false);
  });
});

describe("reviewsToRepublishForRating", () => {
  it("is nothing to do when the rating is publishing", () => {
    expect(reviewsToRepublishForRating({ count: 16, average: 5, suppressedCount: 4 })).toBe(0);
    expect(reviewsToRepublishForRating({ count: 4, average: 5, suppressedCount: 2 })).toBe(0);
  });

  it("names the smallest number of republishes that brings the rating back", () => {
    // 7 + 3 judged: one back over the line leaves 2 hidden of 10, exactly the
    // share, which passes.
    expect(reviewsToRepublishForRating({ count: 7, average: 5, suppressedCount: 3 })).toBe(1);
    // 6 + 6 judged: 12 ruled on, so at most 2 may stay hidden — four come back.
    expect(reviewsToRepublishForRating({ count: 6, average: 5, suppressedCount: 6 })).toBe(4);
  });

  it("answers with a number that actually clears the line", () => {
    // The property worth holding, checked across every shape that is over it
    // rather than at two hand-picked points: republishing exactly this many is
    // enough, and one fewer is not.
    for (let count = 1; count <= 30; count++) {
      for (let suppressed = 0; suppressed <= 30; suppressed++) {
        const aggregate = { count, average: 5, suppressedCount: suppressed };
        const needed = reviewsToRepublishForRating(aggregate);
        if (needed === 0) continue;
        expect(
          ratingIsRepresentative({
            count: count + needed,
            average: 5,
            suppressedCount: suppressed - needed,
          }),
        ).toBe(true);
        expect(
          ratingIsRepresentative({
            count: count + needed - 1,
            average: 5,
            suppressedCount: suppressed - needed + 1,
          }),
        ).toBe(false);
      }
    }
  });
});
