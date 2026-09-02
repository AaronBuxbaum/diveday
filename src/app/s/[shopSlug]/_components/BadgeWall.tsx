import { brandBadgeLabel } from "@/i18n/brand-labels";
import type { DiverTranslator } from "@/i18n/messages";
import type { BrandBadgeCode } from "@/lib/brand";

/**
 * The badge wall (Harbor — ADR 20260901-diveday-reimagined, decision 2): the
 * affiliations a shop chose, in the order it chose them, plus the year it
 * opened. Every badge is a text pill with one drawn glyph — DiveDay's words in
 * the reader's language, never an agency's mark — and, like the conservation
 * commitments beside it, each is the shop's own claim.
 */
export function BadgeWall({
  badges,
  establishedYear,
  t,
  className = "",
}: {
  badges: readonly BrandBadgeCode[];
  establishedYear: number | null;
  t: DiverTranslator;
  className?: string;
}) {
  if (badges.length === 0 && establishedYear === null) return null;
  return (
    <ul className={`flex flex-wrap gap-2 ${className}`.trim()}>
      {establishedYear !== null ? (
        <li className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-sm tabular-nums">
          {t("brand.since", { year: establishedYear })}
        </li>
      ) : null}
      {badges.map((code) => (
        <li
          key={code}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-sm"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-3.5 shrink-0 text-primary"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 1.5 13 3.5v4c0 3.2-2.1 5.6-5 6.8-2.9-1.2-5-3.6-5-6.8v-4z" />
            <path d="m5.8 8 1.6 1.6L10.4 6.5" />
          </svg>
          {brandBadgeLabel(code, t)}
        </li>
      ))}
    </ul>
  );
}
