import { DiveDayIcon } from "@/components/StaffDestinationIcon";
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
          {/* Drawn on its ink (`trim`), so the pill's `px-3` reads the same on
              the shield's side as on the words'. In its square the shield sat
              2px inside the box. */}
          <DiveDayIcon
            name="badge"
            trim
            strokeWidth={2.4}
            className="h-3.5 w-auto shrink-0 text-primary"
          />
          {brandBadgeLabel(code, t)}
        </li>
      ))}
    </ul>
  );
}
