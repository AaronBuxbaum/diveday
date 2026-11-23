import { DiveDayIcon } from "@/components/DiveDayIcon";
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
  phoneLimit,
}: {
  badges: readonly BrandBadgeCode[];
  establishedYear: number | null;
  t: DiverTranslator;
  className?: string;
  /**
   * The most pills a phone shows before a quiet "N more" opens the rest
   * (#4933). The welcome band sets it so its two doors stay on the first
   * screen; from `sm` up every pill shows as before. The year counts as a pill.
   */
  phoneLimit?: number;
}) {
  const pills = [
    ...(establishedYear !== null
      ? [{ id: "since", label: t("brand.since", { year: establishedYear }), figures: true }]
      : []),
    ...badges.map((code) => ({ id: code, label: brandBadgeLabel(code, t), figures: false })),
  ];
  if (pills.length === 0) return null;
  const folded = phoneLimit !== undefined ? pills.slice(phoneLimit) : [];
  const shown = phoneLimit !== undefined && folded.length > 0 ? pills.slice(0, phoneLimit) : pills;
  return (
    <ul className={`flex flex-wrap gap-2 ${className}`.trim()}>
      {shown.map((pill) => (
        <Pill key={pill.id} label={pill.label} figures={pill.figures} />
      ))}
      {folded.length > 0 ? (
        <>
          {/* Wide screens keep every pill; a phone shows the rest inside a
              native `<details>`, so it opens without script. */}
          {folded.map((pill) => (
            <Pill
              key={pill.id}
              label={pill.label}
              figures={pill.figures}
              className="max-sm:hidden"
            />
          ))}
          <li className="sm:hidden has-[details[open]]:basis-full">
            <details>
              <summary className="inline-flex min-h-9 cursor-pointer list-none items-center px-1 text-sm text-muted underline-offset-2 hover:underline focus-visible:focus-ring-inset [&::-webkit-details-marker]:hidden">
                {t("brand.moreBadges", { count: folded.length })}
              </summary>
              <ul className="mt-2 flex flex-wrap gap-2">
                {folded.map((pill) => (
                  <Pill key={pill.id} label={pill.label} figures={pill.figures} />
                ))}
              </ul>
            </details>
          </li>
        </>
      ) : null}
    </ul>
  );
}

function Pill({
  label,
  figures,
  className = "",
}: {
  label: string;
  figures: boolean;
  className?: string;
}) {
  return (
    <li
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-sm${figures ? " tabular-nums" : ""} ${className}`.trim()}
    >
      {/* The shield every pill wears (visual review 2026-10-24, B41): the year
          was the one pill without it. */}
      <BadgeShield />
      {label}
    </li>
  );
}

/**
 * Drawn on its ink (`trim`), so the pill's `px-3` reads the same on the
 * shield's side as on the words'. In its square the shield sat 2px inside the
 * box.
 */
function BadgeShield() {
  return (
    <DiveDayIcon
      name="badge"
      trim
      strokeWidth={2.4}
      className="h-3.5 w-auto shrink-0 text-primary"
    />
  );
}
