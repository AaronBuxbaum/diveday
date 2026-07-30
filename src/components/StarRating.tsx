import { REVIEW_RATINGS, ratingLabel } from "@/lib/reviews";

/**
 * A rating as stars. Read-only — the stars themselves are `aria-hidden`
 * decoration and the number is carried by a visually-hidden label, because a
 * row of glyphs announces as nothing useful (or as "star star star star star")
 * to a screen reader.
 */
export function StarRating({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={className}>
      <span aria-hidden="true" className="text-warning">
        {REVIEW_RATINGS.map((value) => (
          <span key={value} className={value <= rating ? "" : "opacity-25"}>
            ★
          </span>
        ))}
      </span>
      <span className="sr-only">{ratingLabel(rating)}</span>
    </span>
  );
}
