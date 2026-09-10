import type { ShopYearCard } from "@/lib/shop-year";
import {
  YEAR_CARD_SIZE,
  type YearCardPalette,
  yearCardBackground,
  yearCardPalette,
} from "@/lib/year-card";

/**
 * **The shop's year as one 3:2 image** (ADR 20260908-one-hand, decision 6,
 * lever T) — the pass's shape at card size, in the shop's colour, with the
 * year's sentence, three facts and the strip of days.
 *
 * Two routes draw it and it is the same pixels in both: the staff act on the
 * year page ("Print the card"), and the public route DiveDay's homepage band
 * embeds for a shop that turned the switch on. That is the whole reason it is
 * a shared element rather than a copy in each — the homepage's claim is that
 * the card it shows is the card the shop has.
 *
 * **Divers, boats and sites only.** No money, on the card or on the band, and
 * never a diver's name: the card leaves the shop, so the figures it carries are
 * the ones a shop hands a landlord, not the ones it hands an accountant. The
 * words arrive already translated — satori rasterizes to a bitmap and cannot
 * reach a message bundle.
 *
 * It takes a `ShopYearCard`, never the whole summary: the close-outs carry the
 * name of the staff member who wrote each one, and a type without them is what
 * stops a later edit reaching one field further (security review, finding 2).
 *
 * Hex and `rgba` values, deliberately: there is no stylesheet behind a satori
 * render, so a custom property has nothing to resolve against. They all come
 * from `src/lib/year-card.ts`, which is where the shop's colour becomes a sea.
 */

/** Every string on the card, resolved by the route that renders it. */
export type YearCardCopy = {
  /** The shop's own name. */
  shopName: string;
  /** "2026 · to Aug 27", or "2026 · since May", or just "2026". */
  range: string;
  /** "2,907 divers. 262 boats out. 48 reefs and wrecks." */
  sentence: string;
  /** The three facts: a figure and the line under it. */
  facts: { key: string; value: string; label: string }[];
};

export function YearCard({
  year,
  copy,
  brandColor,
}: {
  year: ShopYearCard;
  copy: YearCardCopy;
  /** The shop's `#rrggbb`, or null for DiveDay's own lagoon. */
  brandColor: string | null;
}) {
  const palette = yearCardPalette(brandColor);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 56,
        backgroundImage: yearCardBackground(palette),
        backgroundColor: palette.far,
        color: palette.ink,
        fontSize: 32,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div
          style={{
            display: "flex",
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          {copy.shopName}
        </div>
        <div style={{ display: "flex", fontSize: 22, color: palette.muted }}>{copy.range}</div>
      </div>

      <div
        style={{
          display: "flex",
          fontSize: 62,
          fontWeight: 700,
          lineHeight: 1.14,
          letterSpacing: "-0.02em",
          maxWidth: 1000,
        }}
      >
        {copy.sentence}
      </div>

      <div style={{ display: "flex", gap: 40 }}>
        {copy.facts.map((fact) => (
          <div key={fact.key} style={{ display: "flex", flexDirection: "column", flex: 1, gap: 8 }}>
            <div style={{ display: "flex", fontSize: 44, fontWeight: 700 }}>{fact.value}</div>
            <div
              style={{
                display: "flex",
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: palette.muted,
              }}
            >
              {fact.label}
            </div>
          </div>
        ))}
      </div>

      <YearCardStrip year={year} palette={palette} />
    </div>
  );
}

/**
 * The strip at card size: the same fifty-odd columns of seven the year page
 * draws, in the ink at four strengths rather than in the lagoon. Laid out as
 * explicit columns because satori implements a subset of flexbox and no CSS
 * grid at all.
 */
function YearCardStrip({ year, palette }: { year: ShopYearCard; palette: YearCardPalette }) {
  const columns: ShopYearCard["strip"][] = [];
  for (let index = 0; index < year.strip.length; index += 7) {
    columns.push(year.strip.slice(index, index + 7));
  }
  return (
    <div style={{ display: "flex", gap: 3 }}>
      {columns.map((week, column) => (
        <div
          key={week.find((cell) => cell.day)?.day ?? `week-${column}`}
          style={{ display: "flex", flexDirection: "column", gap: 3 }}
        >
          {week.map((cell, row) => (
            <div
              key={cell.day ?? `pad-${column}-${row}`}
              style={{
                display: "flex",
                width: 15,
                height: 15,
                borderRadius: 2,
                // A padding square before the year's first day draws nothing at
                // all; a day at sea draws its water.
                backgroundColor: cell.day === null ? "transparent" : palette.fills[cell.fill],
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export { YEAR_CARD_SIZE };
