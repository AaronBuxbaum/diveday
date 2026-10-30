import {
  AA_TEXT_CONTRAST,
  BRAND_INK,
  contrastRatio,
  DIVEDAY_BRAND_COLOR,
  mixHex,
  parseBrandColor,
} from "./brand";

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
  /** The shop's own colour. */
  mid: string;
  /** The gradient's far corner. */
  far: string;
  /** The card's reading ink, chosen to read on all three gradient stops. */
  ink: string;
  /** Labels and the range line, one step quieter. */
  muted: string;
  /** The strip's four levels, drawn in the ink at four strengths. */
  fills: readonly [string, string, string, string];
};

/**
 * The sea a shop's colour makes. Light brands keep their light hue and use
 * dark ink; dark brands use paper-white ink. A mid-tone brand moves toward
 * black only as far as needed for the white ink to meet AA. Each gradient's
 * other stops move farther toward their ink's matching end, so the entire
 * gradient keeps that contrast. A shop that set no colour gets DiveDay's own
 * lagoon.
 */
export function yearCardPalette(brandColor: string | null | undefined): YearCardPalette {
  const { value } = parseBrandColor(brandColor ?? "");
  const brand = value ?? DIVEDAY_BRAND_COLOR;
  const paperInk = "#fffdf8";
  const lightBrand = contrastRatio(BRAND_INK, brand) >= AA_TEXT_CONTRAST;
  if (lightBrand) {
    return {
      near: mixHex(brand, "#ffffff", 0.24),
      mid: brand,
      far: mixHex(brand, "#ffffff", 0.12),
      ink: BRAND_INK,
      muted: "rgba(22, 35, 44, 0.78)",
      fills: [
        "rgba(22, 35, 44, 0.16)",
        "rgba(22, 35, 44, 0.38)",
        "rgba(22, 35, 44, 0.64)",
        BRAND_INK,
      ],
    };
  }

  const ink = paperInk;
  let near = brand;
  // A mid-tone brand may not carry either ink. Keep the deep-card treatment
  // and move it toward black in small, deterministic steps, retaining hue.
  for (let step = 0; step < 16 && contrastRatio(ink, near) < AA_TEXT_CONTRAST; step += 1) {
    near = mixHex(near, "#000000", 0.08);
  }
  return {
    near,
    mid: mixHex(near, "#000000", 0.18),
    far: mixHex(near, "#000000", 0.68),
    ink,
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
