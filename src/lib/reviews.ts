/**
 * Verified-diver reviews: the rules that decide what a rating is worth, what a
 * comment may say, and who a review is signed by. Framework-free so the same
 * bounds apply to the public token-auth write path, the staff moderation
 * surface, and the structured-data builder (docs ADR
 * 20260729-verified-diver-reviews).
 */

export const MIN_REVIEW_RATING = 1;
export const MAX_REVIEW_RATING = 5;

/**
 * Server-side comment bound. The form caps at this length too, but the write
 * path is public (recap-token auth), so the real cap lives here — an untrusted
 * caller's comment is truncated, never stored unbounded. Long enough for a real
 * "here's how the day went", short enough to read on a phone.
 */
export const MAX_REVIEW_COMMENT_LENGTH = 500;

/** A rating a diver can actually pick, low to high. */
export const REVIEW_RATINGS = [1, 2, 3, 4, 5] as const;

export type ReviewRating = (typeof REVIEW_RATINGS)[number];

/** True for a whole number inside the 1–5 scale the schema check also enforces. */
export function isReviewRating(value: unknown): value is ReviewRating {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_REVIEW_RATING &&
    value <= MAX_REVIEW_RATING
  );
}

/** A form value to a rating, or null when it isn't one — never a coerced 0 or NaN. */
export function parseReviewRating(value: unknown): ReviewRating | null {
  const parsed = typeof value === "string" ? Number(value.trim()) : value;
  return isReviewRating(parsed) ? parsed : null;
}

/**
 * A diver's words, trimmed, inner whitespace collapsed, and bounded. Empty (or
 * whitespace-only) becomes null rather than an empty string, so "rated but said
 * nothing" is one representable state instead of two.
 */
export function normalizeReviewComment(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed ? collapsed.slice(0, MAX_REVIEW_COMMENT_LENGTH) : null;
}

/**
 * A bare rating has no text to moderate, so it counts the moment it's given; a
 * review carrying words waits for staff, because those words land on the shop's
 * public schedule page. This is the whole moderation policy in one predicate.
 */
export function publishesImmediately(comment: string | null): boolean {
  return comment === null;
}

export type ReviewAggregate = {
  /** How many published reviews the average is over; 0 means "no reviews yet". */
  count: number;
  /** Mean rating rounded to one decimal, or null when there are no reviews. */
  average: number | null;
  /**
   * How many reviews this shop has taken down by a recorded act. Not the same
   * as "unpublished": a review carrying words nobody has read yet is queued,
   * not suppressed, and must not count against the shop here.
   */
  suppressedCount: number;
};

export const EMPTY_REVIEW_AGGREGATE: ReviewAggregate = {
  count: 0,
  average: null,
  suppressedCount: 0,
};

/**
 * How much of a shop's record may be hidden before DiveDay stops publishing
 * its average as a machine-readable claim.
 *
 * One in five. Below that a shop is plausibly removing the spam and the review
 * about the wrong boat; above it, the number describes a set somebody chose
 * rather than the set that came in, and schema.org `aggregateRating` is read by
 * search engines as a measurement rather than a testimonial wall.
 */
export const MAX_SUPPRESSED_SHARE_FOR_RATING = 0.2;

/**
 * How many reviews a shop must have ruled on before the share above means
 * anything.
 *
 * Ten. Under that a ratio is noise rather than a pattern: a shop with three
 * reviews that takes down one piece of spam sits at 33% and would lose its
 * search-result stars over a single honest act, while the shop the rule is
 * actually for — a record curated into a 5.0 — cannot be built out of nine
 * reviews. Every other thin-sample judgement in the product works this way.
 *
 * The cost is a window near the start where suppression is unconstrained, and
 * it is bounded on purpose: below the floor a shop's rating is one no reader
 * is relying on yet, and the tenth judged review closes it.
 */
export const MIN_JUDGED_REVIEWS_FOR_SUPPRESSION = 10;

/**
 * Whether the published average still describes the shop's real record — the
 * one question that decides if `aggregateRating` is emitted
 * (ADR 20260813-review-moderation-has-a-floor).
 *
 * The shop's own page keeps showing its stars either way: those sit above the
 * reviews they are drawn from, where a reader can see what they are looking at.
 * What is withheld is the claim DiveDay makes on the shop's behalf to a machine
 * that will render it as a verdict beside a search result.
 */
export function ratingIsRepresentative(aggregate: ReviewAggregate): boolean {
  // Nothing published is nothing to stand behind. This also catches the shop
  // whose every review is hidden, which arrives here with a real suppressed
  // count and no average to describe anything.
  if (aggregate.count === 0) return false;
  const judged = aggregate.count + aggregate.suppressedCount;
  if (judged < MIN_JUDGED_REVIEWS_FOR_SUPPRESSION) return true;
  return aggregate.suppressedCount / judged <= MAX_SUPPRESSED_SHARE_FOR_RATING;
}

/**
 * Whether a shop has a rating that DiveDay is declining to publish — the
 * question the staff Reviews page asks, which is not quite the one above.
 *
 * `ratingIsRepresentative` is false in two very different situations: a shop
 * with nothing published yet, and a shop whose record has been curated past
 * the line. The first has nothing withheld and nothing to act on; warning it
 * would be nonsense. Only the second gets told.
 */
export function ratingIsWithheld(aggregate: ReviewAggregate): boolean {
  return aggregate.count > 0 && !ratingIsRepresentative(aggregate);
}

/**
 * How many hidden reviews a shop would have to republish to have its rating
 * published again, or 0 when nothing is being withheld.
 *
 * This is what makes the warning actionable instead of merely true. The
 * denominator does not move when a review is republished — it is every review
 * the shop has ruled on either way — so this is just the count that has to
 * come back out of the suppressed side to land under the share.
 */
export function reviewsToRepublishForRating(aggregate: ReviewAggregate): number {
  if (!ratingIsWithheld(aggregate)) return 0;
  const judged = aggregate.count + aggregate.suppressedCount;
  const excess = aggregate.suppressedCount - MAX_SUPPRESSED_SHARE_FOR_RATING * judged;
  // Withheld means the share is strictly over the line, so `excess` is
  // positive and this is at least one. The clamp is against float dust in that
  // multiplication, never against a real zero.
  return Math.max(1, Math.ceil(excess));
}

/**
 * The displayed average, from a count and a sum. Takes the two integers the
 * database can produce with `count()`/`sum()` rather than the ratings
 * themselves, so a shop with thousands of reviews never loads them all to show
 * one number — and so the rounding rule lives in exactly one tested place.
 */
export function reviewAggregate(count: number, sum: number, suppressedCount = 0): ReviewAggregate {
  if (count <= 0) return { ...EMPTY_REVIEW_AGGREGATE, suppressedCount };
  return { count, average: Math.round((sum / count) * 10) / 10, suppressedCount };
}

/**
 * How a review is signed in public: first name plus a last initial ("Marta R."),
 * the most a shop's page should ever say about someone who came diving. A
 * single-word name stands alone; an empty one comes back as `""` — absence,
 * never words. The rendering surface picks its own localized neutral byline
 * (`reviews.anonymousReviewer` in the diver bundle); this layer holds no prose.
 */
export function reviewerDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const [first, ...rest] = parts;
  const last = rest[rest.length - 1];
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
}

/**
 * Public review selection policy: staff-curated standouts come first; the
 * remainder is the strongest available rating, with the newest review first
 * inside each bucket. Keeping the comparison framework-free makes the policy
 * directly testable and keeps the database ordering and any future export
 * ordering aligned.
 */
export function comparePublicReviews(
  a: { isStandout: boolean; rating: number; publishedAt: Date },
  b: { isStandout: boolean; rating: number; publishedAt: Date },
): number {
  if (a.isStandout !== b.isStandout) return a.isStandout ? -1 : 1;
  if (!a.isStandout && a.rating !== b.rating) return b.rating - a.rating;
  return b.publishedAt.getTime() - a.publishedAt.getTime();
}
