/**
 * A shop's own brand, and what DiveDay derives from it.
 *
 * Harbor (ADR 20260901-diveday-reimagined, decision 2): every diver-facing
 * surface and every embed wears the **shop's** colour, display face, photographs
 * and badge wall, with DiveDay as a credit line. This module is the pure half —
 * the closed lists a shop chooses from and the arithmetic that turns one hex
 * colour into the four tokens the public layout emits. It knows nothing about
 * React, the database or the request.
 *
 * Two rules the ADR states that this file enforces rather than remembers:
 *
 * - **A brand colour never fails contrast.** `deriveBrandTheme` checks the
 *   colour as *text* — every storefront link, the selected pill's own words
 *   over its tint — against the ground and the tint, and darkens it until it
 *   reads; a colour that reads on sand is dark enough for white text on it as
 *   a fill. The theme says so (`adjusted`) rather than the storefront saying
 *   anything.
 * - **Codes, never words.** A display face and a badge are codes so they arrive
 *   in every language and so DiveDay never draws a logo it has no right to
 *   show. The words live in the message bundles; this file owns the lists.
 */

export const BRAND_DISPLAY_FONTS = {
  bricolage_grotesque: {
    family: "Bricolage Grotesque",
    fallback: "'Helvetica Neue', Arial, sans-serif",
    google: "Bricolage+Grotesque:wght@500;600;700;800",
  },
  outfit: {
    family: "Outfit",
    fallback: "'Helvetica Neue', Arial, sans-serif",
    google: "Outfit:wght@500;600;700",
  },
  sora: {
    family: "Sora",
    fallback: "'Helvetica Neue', Arial, sans-serif",
    google: "Sora:wght@500;600;700",
  },
  playfair_display: {
    family: "Playfair Display",
    fallback: "'Iowan Old Style', Georgia, serif",
    google: "Playfair+Display:wght@500;600;700",
  },
  archivo_black: {
    family: "Archivo Black",
    fallback: "Impact, 'Arial Black', sans-serif",
    google: "Archivo+Black",
  },
  lora: {
    family: "Lora",
    fallback: "Georgia, 'Times New Roman', serif",
    google: "Lora:wght@500;600;700",
  },
} as const;

export type BrandDisplayFontCode = keyof typeof BRAND_DISPLAY_FONTS;

export const BRAND_DISPLAY_FONT_CODES = Object.keys(
  BRAND_DISPLAY_FONTS,
) as readonly BrandDisplayFontCode[];

export function isBrandDisplayFontCode(value: unknown): value is BrandDisplayFontCode {
  return typeof value === "string" && value in BRAND_DISPLAY_FONTS;
}

/** The CSS `font-family` value for a chosen face, with its fallback stack. */
export function brandDisplayFontFamily(code: BrandDisplayFontCode): string {
  const face = BRAND_DISPLAY_FONTS[code];
  return `'${face.family}', ${face.fallback}`;
}

/** The Google Fonts stylesheet URL that loads exactly the chosen face. */
export function brandDisplayFontStylesheet(code: BrandDisplayFontCode): string {
  return `https://fonts.googleapis.com/css2?family=${BRAND_DISPLAY_FONTS[code].google}&display=swap`;
}

/**
 * The badge wall's vocabulary. Every entry is an affiliation a real dive shop
 * puts on its own site (the 2026-09-01 research behind the ADR); DiveDay renders
 * each as a text badge in the reader's language and never as the agency's mark.
 */
export const BRAND_BADGE_CODES = [
  "padi_5_star",
  "padi_idc",
  "ssi_diamond",
  "naui_pro",
  "tripadvisor",
  "blue_star",
  "green_fins",
  "dan_partner",
  "readers_choice",
] as const;

export type BrandBadgeCode = (typeof BRAND_BADGE_CODES)[number];

export function isBrandBadgeCode(value: unknown): value is BrandBadgeCode {
  return typeof value === "string" && (BRAND_BADGE_CODES as readonly string[]).includes(value);
}

/**
 * Validate a submitted badge list. Unknown strings drop, duplicates collapse,
 * and — unlike the conservation commitments — **the shop's order is kept**: a
 * badge wall is read left to right, and which affiliation comes first is the
 * shop's call.
 */
export function parseBrandBadges(input: unknown): BrandBadgeCode[] {
  if (!Array.isArray(input)) return [];
  const out: BrandBadgeCode[] = [];
  for (const item of input) {
    if (isBrandBadgeCode(item) && !out.includes(item)) out.push(item);
  }
  return out;
}

/**
 * Normalise a submitted colour to the one stored shape, `#rrggbb` lowercase.
 * Blank means "no brand colour" and is `{ value: null, valid: true }`; anything
 * that is not six hex digits (with or without the `#`) is invalid.
 */
export function parseBrandColor(input: unknown): { value: string | null; valid: boolean } {
  if (input == null) return { value: null, valid: true };
  const raw = String(input).trim();
  if (raw === "") return { value: null, valid: true };
  const match = /^#?([0-9a-fA-F]{6})$/.exec(raw);
  if (!match) return { value: null, valid: false };
  return { value: `#${match[1].toLowerCase()}`, valid: true };
}

type Rgb = { r: number; g: number; b: number };

function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const part = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2 relative luminance. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2 contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

/** `amount` of `into` mixed into `hex`, in sRGB — the same arithmetic as `color-mix(in srgb, …)`. */
export function mixHex(hex: string, into: string, amount: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(into);
  const t = Math.min(1, Math.max(0, amount));
  return rgbToHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });
}

/** DiveDay's own lagoon — what a shop with no brand colour wears, and the picker's resting value. */
export const DIVEDAY_BRAND_COLOR = "#0e7490";

export const AA_TEXT_CONTRAST = 4.5;
const WHITE = "#ffffff";
/** DiveDay's ink, the darker of the two candidate texts on a brand fill. */
export const BRAND_INK = "#0c2a35";
/** Reef's shell — the surface a tint is mixed over when the caller names none. */
export const BRAND_DEFAULT_SURFACE = "#fffdf8";
/** Reef's sand — the ground a storefront's links sit on, so the colour has to read as text on it. */
export const BRAND_DEFAULT_GROUND = "#fbf7ef";

export type BrandTheme = {
  /** The button fill and link colour, darkened if the shop's colour failed contrast. */
  primary: string;
  /** The fill darkened 12% — hover and pressed. */
  primaryHover: string;
  /** 10% of the fill over the surface — the wash behind a selected row. */
  primaryTint: string;
  /** The text on the fill: white where it reads, ink where the colour is pale. */
  primaryForeground: string;
  /** True when the stored colour had to be darkened to read as text on the ground. */
  adjusted: boolean;
};

/**
 * The derivation rule (ADR 20260901-diveday-reimagined, decision 2, amended
 * 2026-09-02):
 *
 * 1. The colour is darkened in 8% steps until it reads as **text** (4.5:1) on
 *    the ground and on its own tint, and the theme says so. The first cut of
 *    this rule checked the colour only as a button *fill* — white or ink on
 *    it — and the seeded `#158462` passed that while sitting at 4.36 on sand
 *    and 4.03 on its tint, which is what every storefront link and the
 *    selected pill actually are (22 axe failures on 2026-09-02). A colour
 *    that reads on sand has a luminance of at most 0.17, so white reads on it
 *    as a fill at 4.8 or better — one loop serves both readings, and the
 *    "keep a pale colour with ink on it" branch is gone with it: a pale
 *    colour cannot be a link. Twelve steps reach near-black from any hue.
 * 2. The text on the fill is white where it reads, ink where it does not —
 *    which only a ground lighter than sand could still produce.
 *
 * Hover is the fill darkened 12%; the tint is 10% of the fill over the surface.
 * The storefront says nothing about an adjustment; a shop learns in Settings.
 */
export function deriveBrandTheme(
  color: string,
  {
    surface = BRAND_DEFAULT_SURFACE,
    ground = BRAND_DEFAULT_GROUND,
  }: { surface?: string; ground?: string } = {},
): BrandTheme {
  const tintOf = (fill: string) => mixHex(surface, fill, 0.1);
  const readsAsText = (fill: string) =>
    contrastRatio(fill, ground) >= AA_TEXT_CONTRAST &&
    contrastRatio(fill, tintOf(fill)) >= AA_TEXT_CONTRAST;
  let primary = color.toLowerCase();
  for (let step = 0; step < 12 && !readsAsText(primary); step++) {
    primary = mixHex(primary, "#000000", 0.08);
  }
  return {
    primary,
    primaryHover: mixHex(primary, "#000000", 0.12),
    primaryTint: tintOf(primary),
    primaryForeground: contrastRatio(primary, WHITE) >= AA_TEXT_CONTRAST ? WHITE : BRAND_INK,
    adjusted: primary !== color.toLowerCase(),
  };
}

/**
 * The theme as the custom properties the public layout sets on its root, so
 * every primitive beneath — `buttonClass`, the ledger row, a selected pill —
 * re-skins with no per-component work.
 */
export function brandThemeProperties(theme: BrandTheme): Record<`--${string}`, string> {
  return {
    "--primary": theme.primary,
    "--primary-hover": theme.primaryHover,
    "--primary-tint": theme.primaryTint,
    "--primary-foreground": theme.primaryForeground,
    "--focus-ring": theme.primary,
  };
}
