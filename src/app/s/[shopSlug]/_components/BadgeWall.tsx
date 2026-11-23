import Image from "next/image";
import { DiveDayIcon } from "@/components/DiveDayIcon";
import { BADGE_LOGOS, type BadgeLogo } from "@/features/public-site/badge-logos";
import { brandBadgeLabel } from "@/i18n/brand-labels";
import type { DiverTranslator } from "@/i18n/messages";
import type { BrandBadgeCode } from "@/lib/brand";

/**
 * The badge wall (Harbor — ADR 20260901-diveday-reimagined, decision 2): the
 * affiliations a shop chose, in the order it chose them, plus the year it
 * opened. Every badge is a pill of DiveDay's words in the reader's language,
 * beside the organization's official logo when `BADGE_LOGOS` has one for the
 * code (H-20261123-badge-logos-shipped) and one drawn glyph when it does not.
 * The words always stay, so the logo is decoration, and, like the conservation
 * commitments beside it, each badge is the shop's own claim.
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
      ? [
          {
            id: "since",
            label: t("brand.since", { year: establishedYear }),
            figures: true,
            logo: undefined,
          },
        ]
      : []),
    ...badges.map((code) => ({
      id: code,
      label: brandBadgeLabel(code, t),
      figures: false,
      logo: BADGE_LOGOS[code],
    })),
  ];
  if (pills.length === 0) return null;
  const folded = phoneLimit !== undefined ? pills.slice(phoneLimit) : [];
  const shown = phoneLimit !== undefined && folded.length > 0 ? pills.slice(0, phoneLimit) : pills;
  return (
    <ul className={`flex flex-wrap gap-2 ${className}`.trim()}>
      {shown.map((pill) => (
        <Pill key={pill.id} {...pill} />
      ))}
      {folded.length > 0 ? (
        <>
          {/* Wide screens keep every pill; a phone shows the rest inside a
              native `<details>`, so it opens without script. */}
          {folded.map((pill) => (
            <Pill key={pill.id} {...pill} className="max-sm:hidden" />
          ))}
          <li className="sm:hidden has-[details[open]]:basis-full">
            <details>
              <summary className="inline-flex min-h-9 cursor-pointer list-none items-center px-1 text-sm text-muted underline-offset-2 hover:underline focus-visible:focus-ring-inset [&::-webkit-details-marker]:hidden">
                {t("brand.moreBadges", { count: folded.length })}
              </summary>
              <ul className="mt-2 flex flex-wrap gap-2">
                {folded.map((pill) => (
                  <Pill key={pill.id} {...pill} />
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
  logo,
  className = "",
}: {
  label: string;
  figures: boolean;
  logo: BadgeLogo | undefined;
  className?: string;
}) {
  return (
    <li
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-sm${figures ? " tabular-nums" : ""} ${className}`.trim()}
    >
      {/* The shield every text pill wears (visual review 2026-10-24, B41): the
          year was the one pill without it. A pill with an official logo wears
          the logo instead. */}
      {logo ? <BadgeLogoMark logo={logo} /> : <BadgeShield />}
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

/**
 * The organization's file as published, unaltered, on the ground it was drawn
 * for. The ground does not follow the color scheme: a mark is not recolored for
 * dark mode, so it sits on a small paper or ink tile that reads in both. Empty
 * `alt`, because the pill's words say the same thing.
 */
function BadgeLogoMark({ logo }: { logo: BadgeLogo }) {
  const ground = logo.tone === "dark" ? "bg-device-frame" : "bg-device-frame-foreground";
  return (
    <span className={`-ms-2 inline-flex h-7 shrink-0 items-center rounded-full px-1.5 ${ground}`}>
      <Image
        src={logo.src}
        alt=""
        width={logo.width}
        height={logo.height}
        unoptimized
        className="h-5 w-auto max-w-24"
      />
    </span>
  );
}
