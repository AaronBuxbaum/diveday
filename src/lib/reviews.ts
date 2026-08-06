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
};

export const EMPTY_REVIEW_AGGREGATE: ReviewAggregate = { count: 0, average: null };

/**
 * The displayed average, from a count and a sum. Takes the two integers the
 * database can produce with `count()`/`sum()` rather than the ratings
 * themselves, so a shop with thousands of reviews never loads them all to show
 * one number — and so the rounding rule lives in exactly one tested place.
 */
export function reviewAggregate(count: number, sum: number): ReviewAggregate {
  if (count <= 0) return EMPTY_REVIEW_AGGREGATE;
  return { count, average: Math.round((sum / count) * 10) / 10 };
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
