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
 *
 * **The mark is drawn, and the ink is the caller's** (ADR
 * 20260827-clearwater-surface-language, decision 11 — the coral budget). It was
 * the `★` character in `text-warning` on every surface. The budget's table
 * gives the coral star to two of them and no others: **public pages and the
 * diver's own rating input**, where a filled star is *data ink* rather than an
 * earned moment — it counts as one accent appearance however many stars a page
 * fills, and never fires beside a moment. Staff keep the amber, because a
 * moderation queue is work rather than a celebration, and that is why `tone`
 * defaults to it: a new caller has to ask for the accent.
 */
export function StarRating({
  rating,
  label,
  tone = "warning",
  className,
}: {
  rating: number;
  label: string;
  /** `accent` on public pages and the diver's own input; `warning` everywhere staff read. */
  tone?: "accent" | "warning";
  className?: string;
}) {
  return (
    <span className={className}>
      <span
        aria-hidden="true"
        className={`inline-flex items-center gap-0.5 ${
          tone === "accent" ? "text-accent" : "text-warning"
        }`}
      >
        {REVIEW_RATINGS.map((value) => (
          // One drawn mark, filled or faded — never two glyphs, so a half-lit
          // row is one shape at one weight, and it scales with the type it sits
          // in rather than with a fixed pixel box.
          <svg
            key={value}
            viewBox="0 0 20 20"
            aria-hidden="true"
            className={`size-[1.15em] ${value <= rating ? "" : "opacity-25"}`}
          >
            <path
              fill="currentColor"
              d="M10 1.8 12.47 6.81 18 7.61 14 11.51 14.94 17.02 10 14.42 5.06 17.02 6 11.51 2 7.61 7.53 6.81Z"
            />
          </svg>
        ))}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
