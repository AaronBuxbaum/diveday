import { REVIEW_RATINGS } from "@/lib/reviews";

/**
 * A rating as stars. Read-only — the stars themselves are `aria-hidden`
 * decoration and the number is carried by a visually-hidden label, because a
 * row of glyphs announces as nothing useful (or as "star star star star star")
 * to a screen reader.
 *
 * `label` is that spoken text, already translated by the caller — the diver
 * surfaces interpolate `reviews.ratingOption` from the diver bundle, staff
 * surfaces `reviews.rating` from the staff bundle — because this component
 * renders on both sides and must not pick a language itself.
 */
export function StarRating({
  rating,
  label,
  className,
}: {
  rating: number;
  label: string;
  className?: string;
}) {
  return (
    <span className={className}>
      <span aria-hidden="true" className="text-warning">
        {REVIEW_RATINGS.map((value) => (
          <span key={value} className={value <= rating ? "" : "opacity-25"}>
            ★
          </span>
        ))}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
