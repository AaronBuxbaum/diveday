/**
 * **The face a course card wears when the shop has not given it a photo.**
 *
 * The storefront's courses shelf (ADR 20260827-clearwater-surface-language,
 * decision 8) shows three cards, and `courses.heroImageUrl` is optional — most
 * shops fill one or two and leave the rest. The alternatives were a grey box, a
 * stock photograph of somebody else's reef, or this: one drawn swell in the
 * shop's own primary tint, so a card with no picture still reads as a card
 * rather than as a gap where a picture failed to load.
 *
 * Two rules it keeps. **Drawn, never emoji** — the ADR's accessibility carry-over
 * for anything new. And **the primary tint only**: coral is rationed by
 * decision 11's table, which spends the storefront's one accent on the review
 * stars, so a decorative wave in the accent would be an unbudgeted pixel taking
 * that scarcity away from data ink.
 *
 * Purely decorative: `aria-hidden`, and the card's own heading is what names
 * the course.
 */
export function CourseWavePlaceholder({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`flex items-end overflow-hidden bg-primary-tint ${className}`.trim()}
    >
      <svg
        viewBox="0 0 240 96"
        preserveAspectRatio="none"
        className="h-full w-full text-primary"
        role="presentation"
      >
        <path
          d="M0 62c26-16 48-16 72 0s46 16 72 0 46-16 72 0v34H0Z"
          fill="currentColor"
          opacity="0.16"
        />
        <path
          d="M0 74c26-14 48-14 72 0s46 14 72 0 46-14 72 0v22H0Z"
          fill="currentColor"
          opacity="0.26"
        />
        <path
          d="M0 60c26-16 48-16 72 0s46 16 72 0 46-16 72 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.5"
        />
      </svg>
    </div>
  );
}
