import { DIVEDAY_BRAND_COLOR, mixHex, parseBrandColor } from "./brand";

/**
 * **The year card's palette** (ADR 20260908-one-hand, decision 6, lever T).
 *
 * The card is a 3:2 image the shop sends to its crew, its landlord and its
 * marina, and — with the shop's yes — the one proof DiveDay's homepage carries.
 * It is rendered by satori into a bitmap with no stylesheet behind it, so the
 * semantic tokens cannot reach it and the colours have to be values. They live
 * here rather than in the route for the reason `src/app/_og/card.tsx` gives for
 * the link-preview chrome: two routes draw this card, and a palette copied into
 * both is a palette that drifts.
 *
 * **The band is drawn, never fetched.** The design calls for the shop's own
 * photograph with a drawn band standing in when it has none; this renders the
 * band in every case. Pulling `brand_hero_image_url` server-side would make a
 * staff-typed URL into an outbound request from DiveDay's own servers, and a
 * fetch that hangs or 404s inside an `ImageResponse` severs the socket after
 * the 200 is already on the wire (src/lib/og-rasterizer.ts documents that
 * failure at length). The shop's colour and its name carry its face here.
 */

/** 3:2, the shape the design draws and the shape a printed card is trimmed to. */
export const YEAR_CARD_SIZE = { width: 1200, height: 800 } as const;

export type YearCardPalette = {
  /** The gradient's near corner — the shallows. */
  near: string;
  /** The shop's colour, at depth. */
  mid: string;
  /** The gradient's far corner. */
  far: string;
  /** The card's reading ink: DiveDay's paper white, which reads on all three. */
  ink: string;
  /** Labels and the range line, one step quieter. */
  muted: string;
  /** The strip's four levels, drawn in the ink at four strengths. */
  fills: readonly [string, string, string, string];
};

/**
 * The sea a shop's colour makes. Every value is the shop's own hue moved
 * toward white or black, so a shop that set no colour gets DiveDay's lagoon and
 * a shop that set one gets its own, and neither can produce a card whose text
 * fails to read: the ink is paper white and the deepest of the three grounds is
 * more than half-way to black.
 */
export function yearCardPalette(brandColor: string | null | undefined): YearCardPalette {
  const { value } = parseBrandColor(brandColor ?? "");
  const brand = value ?? DIVEDAY_BRAND_COLOR;
  return {
    near: mixHex(brand, "#ffffff", 0.32),
    mid: mixHex(brand, "#000000", 0.18),
    far: mixHex(brand, "#000000", 0.68),
    ink: "#fffdf8",
    muted: "rgba(255, 253, 248, 0.82)",
    fills: [
      "rgba(255, 253, 248, 0.18)",
      "rgba(255, 253, 248, 0.42)",
      "rgba(255, 253, 248, 0.7)",
      "#fffdf8",
    ],
  };
}

/** The card's ground, as one CSS gradient. */
export function yearCardBackground(palette: YearCardPalette): string {
  return `radial-gradient(120% 90% at 28% 18%, ${palette.near} 0%, ${palette.mid} 44%, ${palette.far} 100%)`;
}
