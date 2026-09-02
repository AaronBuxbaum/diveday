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
 * - **A brand colour never fails contrast, in either scheme.** The colour is
 *   checked as text on the ground it paints on and as a fill under its ink;
 *   one that fails is moved until it reads, and the theme says so (`adjusted`)
 *   rather than the storefront saying anything. One colour, two derivations —
 *   `deriveBrandTheme` for the light scheme and `deriveDarkBrandTheme` for the
 *   dark, which move in opposite directions from the same input.
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
/**
 * The ground the storefront paints on (`--background`), not the shell a card
 * paints on: the brand colour is *text* on the ground — a link, a current nav
 * chip, a price — and the ground is the darker of the two, so it is the one
 * the contrast check has to clear.
 */
export const BRAND_DEFAULT_SURFACE = "#fbf7ef";

/**
 * One scheme's worth of tokens. The same shop colour yields two of these —
 * {@link deriveBrandTheme} for the light scheme and
 * {@link deriveDarkBrandTheme} for the dark — so every field below reads
 * "moved toward the scheme's far end" rather than "darkened": at depth the
 * moves all run the other way.
 */
export type BrandTheme = {
  /** The button fill and link colour, moved if the shop's colour failed contrast. */
  primary: string;
  /** The fill moved 12% further — hover and pressed. */
  primaryHover: string;
  /** 8% of the fill over the surface — the wash behind a selected row. */
  primaryTint: string;
  /** The text on the fill: white on a dark fill, ink on a light one. */
  primaryForeground: string;
  /** True when the stored colour had to be moved to read. */
  adjusted: boolean;
};

/** The tint's share of the fill over the surface — see `deriveBrandTheme`. */
const TINT_MIX = 0.08;

const BLACK = "#000000";
/** One 8% step, and the twelve of them that reach either end from any hue. */
const STEP = 0.08;
const MAX_STEPS = 12;

/**
 * The derivation rule (ADR 20260901-diveday-reimagined, decision 2): the
 * colour is checked against the shop's ground *and* against white.
 *
 * 1. The colour is text before it is a fill — a link, the current nav chip on
 *    its own tint, a price — so it is darkened in 8% steps until it reads
 *    (4.5:1) on the surface and on its 8% tint over that surface. Until
 *    2026-09-02 only the fill half ran, and axe failed every storefront link
 *    on the demo shop's `#158462` at 4.36:1.
 * 2. Then, as a fill: if white reads on it, white is the ink; else if ink
 *    reads on it — a pale brand on a dark surface — ink is; else it is
 *    darkened until white reads. (On a light surface, a colour that passed
 *    step 1 already takes white: the ground is within a few percent of white.)
 * 3. `adjusted` says whether either step moved it. The storefront says
 *    nothing; a shop learns in Settings.
 *
 * Hover is the fill darkened 12%; the tint is 8% of the fill over the surface
 * (10% until 2026-09-02: at 10%, DiveDay's own lagoon read on its tint at
 * 4.38:1 and would have been nudged darker by its own rule).
 */
export function deriveBrandTheme(
  color: string,
  { surface = BRAND_DEFAULT_SURFACE }: { surface?: string } = {},
): BrandTheme {
  return derive(color, {
    grounds: [surface],
    tintOver: surface,
    toward: BLACK,
    // On a light ground a colour that passed step 1 already takes white; ink is
    // the fallback for the pale-brand-on-a-dark-surface caller.
    inks: [WHITE, BRAND_INK],
  });
}

/**
 * The dark scheme's ground (`--background`) and shell (`--surface`), from
 * globals.css's `@media (prefers-color-scheme: dark)` block. Pinned against
 * that file by `brand.test.ts`, because a palette that moved without these
 * moving would leave the derivation checking a ground nothing paints.
 */
export const BRAND_DARK_GROUND = "#071720";
export const BRAND_DARK_SURFACE = "#0d222d";
/** The night palette's reading ink (`--foreground` at depth), for a preview of the brand at night. */
export const BRAND_DARK_INK = "#e9f3f4";

/**
 * The same colour, derived for the dark scheme (issue #1265).
 *
 * `BrandStyle` emits one `:root` block that wins in **both** schemes, so
 * before this existed a branded storefront wore its light-mode colour at
 * depth: the seeded green derives to `#13795a`, which reads **3.39:1** on the
 * dark ground and **3.05:1** on the dark shell. DiveDay's own lagoon `#0e7490`
 * measures 3.40 / 3.05 there too — which is exactly why the dark palette
 * carries its own `--primary: #22d3ee` at 10:1. Every branded shop was losing
 * that and getting sub-AA links, pills and focus rings across the storefront,
 * and the a11y spec, which scanned light only, stayed green over it.
 *
 * **One colour, two derivations** (ADR 20260901-diveday-reimagined, decision 2,
 * amended 2026-09-02) — not a second picker. The rule is
 * {@link deriveBrandTheme}'s with every polarity flipped: lighten toward white
 * rather than darken toward black, and prefer ink on the fill rather than
 * white, because a fill light enough to read at depth is too light for white
 * text.
 *
 * Both dark surfaces are checked, not just the ground. In the light scheme the
 * ground is the *darker* of the two and so the binding one; at depth that
 * inverts — the shell `#0d222d` is lighter than the ground `#071720`, so a
 * light fill reads worse on it, and it is the shell that decides. Checking
 * both keeps the rule true whichever way a future palette moves it.
 */
export function deriveDarkBrandTheme(
  color: string,
  {
    ground = BRAND_DARK_GROUND,
    surface = BRAND_DARK_SURFACE,
  }: { ground?: string; surface?: string } = {},
): BrandTheme {
  return derive(color, {
    grounds: [ground, surface],
    // The tint is a wash behind a row, and a row sits on the shell — matching
    // the dark palette's own `color-mix(in srgb, var(--primary) …, var(--surface))`.
    tintOver: surface,
    toward: WHITE,
    inks: [BRAND_INK, WHITE],
  });
}

/**
 * The shared derivation. `toward` is the direction a failing colour is pushed
 * — black for the light scheme, white for the dark — and `inks` is the ink
 * preference in order, the first that reads on the fill winning.
 */
function derive(
  color: string,
  {
    grounds,
    tintOver,
    toward,
    inks,
  }: { grounds: string[]; tintOver: string; toward: string; inks: [string, string] },
): BrandTheme {
  let primary = color.toLowerCase();
  let adjusted = false;
  const readsAsText = (fill: string) =>
    grounds.every(
      (ground) =>
        contrastRatio(fill, ground) >= AA_TEXT_CONTRAST &&
        contrastRatio(fill, mixHex(ground, fill, TINT_MIX)) >= AA_TEXT_CONTRAST,
    );
  // Twelve steps of 8% reach either end from any hue, so this always ends.
  for (let step = 0; step < MAX_STEPS && !readsAsText(primary); step++) {
    primary = mixHex(primary, toward, STEP);
    adjusted = true;
  }
  const [preferred, fallback] = inks;
  let primaryForeground = preferred;
  if (contrastRatio(primary, preferred) < AA_TEXT_CONTRAST) {
    if (contrastRatio(primary, fallback) >= AA_TEXT_CONTRAST) {
      primaryForeground = fallback;
    } else {
      // Twelve steps of 8% reach either end from any hue, so this always ends.
      for (
        let step = 0;
        step < MAX_STEPS && contrastRatio(primary, preferred) < AA_TEXT_CONTRAST;
        step++
      ) {
        primary = mixHex(primary, toward, STEP);
      }
      adjusted = true;
    }
  }
  return {
    primary,
    primaryHover: mixHex(primary, toward, 0.12),
    primaryTint: mixHex(tintOver, primary, TINT_MIX),
    primaryForeground,
    adjusted,
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
