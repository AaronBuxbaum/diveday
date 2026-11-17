import localFont from "next/font/local";
import "./fallbacks.css";

/**
 * **The app's typefaces, committed rather than fetched** (issue #2516).
 *
 * They came through `next/font/google`, which downloads them on every
 * `next build`; twice in a week the download failed and the whole CI run went
 * red with it. These files are the ones that loader fetched (Google's
 * subsets, woff2), licensed under the SIL Open
 * Font License (the `OFL-*.txt` files beside this one).
 *
 * **One call per family and subset, so the pixels do not move.** Google
 * serves each family as a set of `@font-face` rules that share one name and
 * split the character set with `unicode-range`, and `next/font/local` cannot
 * give one call's files different ranges. So each subset is its own call that
 * declares one shared family name and its own range: the stylesheet comes out
 * as the one Google sent, rule for rule and in its order, which matters where
 * two ranges overlap (the later rule wins).
 *
 * **The shared name is the `latin` call's constant** (`plexSans`, not "IBM
 * Plex Sans"), because the loader writes a call's CSS variable from its
 * constant's name whatever the `font-family` declaration says: a variable
 * naming a family no rule declares renders every word in the fallback. Only
 * the `latin` call names the variable the app reads (`--font-plex-sans` and
 * the rest, in `globals.css`); the others carry a variable only so the layout
 * references them, and nothing reads it.
 *
 * Preload is what it was: Plex Sans for `latin` and `latin-ext`, Plex Mono
 * for `latin`, and nothing for Atkinson (boat mode only) or the symbols face
 * (rare glyphs). The metric-matched fallback faces are in `fallbacks.css`,
 * with the values `next/font/google` computed for them, because the local
 * loader would derive different ones from the files.
 *
 * The families: Plex Sans is Logbook's one face (ADR 20261001-logbook), with
 * `latin-ext` because divers' names are not all ASCII; Plex Mono for figures;
 * Atkinson Hyperlegible for boat mode, drawn for sun and spray; and Noto Sans
 * Symbols 2 for the arrows, checkmarks and dingbats (→ ✓ ★ ☀) Plex lacks,
 * pinned so CI does not borrow them from the runner's fontconfig (ADR
 * 20260730-pinned-browser-visual-determinism). Pictographic emoji stay
 * unpinned on purpose: a self-hosted color emoji face overrode every
 * browser's own and was reverted (same ADR).
 *
 * Moving a weight or a subset means fetching the new files from Google Fonts
 * and adding a call here; nothing downloads at build time.
 */

const plexSansCyrillicExt = localFont({
  src: [
    { path: "./plex-sans-cyrillic-ext.woff2", weight: "400", style: "normal" },
    { path: "./plex-sans-cyrillic-ext.woff2", weight: "500", style: "normal" },
    { path: "./plex-sans-cyrillic-ext.woff2", weight: "600", style: "normal" },
    { path: "./plex-sans-cyrillic-ext.woff2", weight: "700", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "plexSans" },
    { prop: "font-stretch", value: "100%" },
    {
      prop: "unicode-range",
      value: "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F",
    },
  ],
  variable: "--font-plex-sans-cyrillic-ext",
  preload: false,
  adjustFontFallback: false,
});

const plexSansCyrillic = localFont({
  src: [
    { path: "./plex-sans-cyrillic.woff2", weight: "400", style: "normal" },
    { path: "./plex-sans-cyrillic.woff2", weight: "500", style: "normal" },
    { path: "./plex-sans-cyrillic.woff2", weight: "600", style: "normal" },
    { path: "./plex-sans-cyrillic.woff2", weight: "700", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "plexSans" },
    { prop: "font-stretch", value: "100%" },
    { prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  ],
  variable: "--font-plex-sans-cyrillic",
  preload: false,
  adjustFontFallback: false,
});

const plexSansGreek = localFont({
  src: [
    { path: "./plex-sans-greek.woff2", weight: "400", style: "normal" },
    { path: "./plex-sans-greek.woff2", weight: "500", style: "normal" },
    { path: "./plex-sans-greek.woff2", weight: "600", style: "normal" },
    { path: "./plex-sans-greek.woff2", weight: "700", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "plexSans" },
    { prop: "font-stretch", value: "100%" },
    {
      prop: "unicode-range",
      value: "U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF",
    },
  ],
  variable: "--font-plex-sans-greek",
  preload: false,
  adjustFontFallback: false,
});

const plexSansVietnamese = localFont({
  src: [
    { path: "./plex-sans-vietnamese.woff2", weight: "400", style: "normal" },
    { path: "./plex-sans-vietnamese.woff2", weight: "500", style: "normal" },
    { path: "./plex-sans-vietnamese.woff2", weight: "600", style: "normal" },
    { path: "./plex-sans-vietnamese.woff2", weight: "700", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "plexSans" },
    { prop: "font-stretch", value: "100%" },
    {
      prop: "unicode-range",
      value:
        "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB",
    },
  ],
  variable: "--font-plex-sans-vietnamese",
  preload: false,
  adjustFontFallback: false,
});

const plexSansLatinExt = localFont({
  src: [
    { path: "./plex-sans-latin-ext.woff2", weight: "400", style: "normal" },
    { path: "./plex-sans-latin-ext.woff2", weight: "500", style: "normal" },
    { path: "./plex-sans-latin-ext.woff2", weight: "600", style: "normal" },
    { path: "./plex-sans-latin-ext.woff2", weight: "700", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "plexSans" },
    { prop: "font-stretch", value: "100%" },
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
  variable: "--font-plex-sans-latin-ext",
  preload: true,
  adjustFontFallback: false,
});

const plexSans = localFont({
  src: [
    { path: "./plex-sans-latin.woff2", weight: "400", style: "normal" },
    { path: "./plex-sans-latin.woff2", weight: "500", style: "normal" },
    { path: "./plex-sans-latin.woff2", weight: "600", style: "normal" },
    { path: "./plex-sans-latin.woff2", weight: "700", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "plexSans" },
    { prop: "font-stretch", value: "100%" },
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
  variable: "--font-plex-sans",
  preload: true,
  adjustFontFallback: false,
  fallback: ["'IBM Plex Sans Fallback'"],
});

const plexMonoCyrillicExt = localFont({
  src: [
    { path: "./plex-mono-cyrillic-ext-400.woff2", weight: "400", style: "normal" },
    { path: "./plex-mono-cyrillic-ext-600.woff2", weight: "600", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "plexMono" },
    {
      prop: "unicode-range",
      value: "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F",
    },
  ],
  variable: "--font-plex-mono-cyrillic-ext",
  preload: false,
  adjustFontFallback: false,
});

const plexMonoCyrillic = localFont({
  src: [
    { path: "./plex-mono-cyrillic-400.woff2", weight: "400", style: "normal" },
    { path: "./plex-mono-cyrillic-600.woff2", weight: "600", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "plexMono" },
    { prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  ],
  variable: "--font-plex-mono-cyrillic",
  preload: false,
  adjustFontFallback: false,
});

const plexMonoVietnamese = localFont({
  src: [
    { path: "./plex-mono-vietnamese-400.woff2", weight: "400", style: "normal" },
    { path: "./plex-mono-vietnamese-600.woff2", weight: "600", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "plexMono" },
    {
      prop: "unicode-range",
      value:
        "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB",
    },
  ],
  variable: "--font-plex-mono-vietnamese",
  preload: false,
  adjustFontFallback: false,
});

const plexMonoLatinExt = localFont({
  src: [
    { path: "./plex-mono-latin-ext-400.woff2", weight: "400", style: "normal" },
    { path: "./plex-mono-latin-ext-600.woff2", weight: "600", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "plexMono" },
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
  variable: "--font-plex-mono-latin-ext",
  preload: false,
  adjustFontFallback: false,
});

const plexMono = localFont({
  src: [
    { path: "./plex-mono-latin-400.woff2", weight: "400", style: "normal" },
    { path: "./plex-mono-latin-600.woff2", weight: "600", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "plexMono" },
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
  variable: "--font-plex-mono",
  preload: true,
  adjustFontFallback: false,
  fallback: ["'IBM Plex Mono Fallback'"],
});

const atkinsonLatinExt = localFont({
  src: [
    { path: "./atkinson-hyperlegible-latin-ext-400.woff2", weight: "400", style: "normal" },
    { path: "./atkinson-hyperlegible-latin-ext-700.woff2", weight: "700", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "atkinson" },
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
  variable: "--font-atkinson-latin-ext",
  preload: false,
  adjustFontFallback: false,
});

const atkinson = localFont({
  src: [
    { path: "./atkinson-hyperlegible-latin-400.woff2", weight: "400", style: "normal" },
    { path: "./atkinson-hyperlegible-latin-700.woff2", weight: "700", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "atkinson" },
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
  variable: "--font-atkinson",
  preload: false,
  adjustFontFallback: false,
  fallback: ["'Atkinson Hyperlegible Fallback'"],
});

const notoSymbolsBraille = localFont({
  src: [{ path: "./noto-sans-symbols-2-braille-400.woff2", weight: "400", style: "normal" }],
  declarations: [
    { prop: "font-family", value: "notoSymbols" },
    { prop: "unicode-range", value: "U+2800-28FF" },
  ],
  variable: "--font-noto-symbols-braille",
  preload: false,
  adjustFontFallback: false,
});

const notoSymbolsMath = localFont({
  src: [{ path: "./noto-sans-symbols-2-math-400.woff2", weight: "400", style: "normal" }],
  declarations: [
    { prop: "font-family", value: "notoSymbols" },
    {
      prop: "unicode-range",
      value:
        "U+0302-0303, U+0305, U+0307-0308, U+0310, U+0312, U+0315, U+031A, U+0326-0327, U+032C, U+032F-0330, U+0332-0333, U+0338, U+033A, U+0346, U+034D, U+0391-03A1, U+03A3-03A9, U+03B1-03C9, U+03D1, U+03D5-03D6, U+03F0-03F1, U+03F4-03F5, U+2016-2017, U+2034-2038, U+203C, U+2040, U+2043, U+2047, U+2050, U+2057, U+205F, U+2070-2071, U+2074-209F, U+20D0-20DC, U+20E1, U+20E5-20EF, U+2100-2112, U+2114-2115, U+2117-2121, U+2123-214F, U+2190, U+2192, U+2194-21AE, U+21B0-21E5, U+21F1-21F2, U+21F4-2211, U+2213-2214, U+2216-22FF, U+2308-230B, U+2310, U+2319, U+231C-2321, U+2336-237A, U+237C, U+2395, U+239B-23B7, U+23D0, U+23DC-23E1, U+2474-2475, U+25AF, U+25B3, U+25B7, U+25BD, U+25C1, U+25CA, U+25CC, U+25FB, U+266D-266F, U+27C0-27FF, U+2900-2AFF, U+2B0E-2B11, U+2B30-2B4C, U+2BFE, U+3030, U+FF5B, U+FF5D, U+1D400-1D7FF, U+1EE00-1EEFF",
    },
  ],
  variable: "--font-noto-symbols-math",
  preload: false,
  adjustFontFallback: false,
});

const notoSymbolsMayanNumerals = localFont({
  src: [{ path: "./noto-sans-symbols-2-mayan-numerals-400.woff2", weight: "400", style: "normal" }],
  declarations: [
    { prop: "font-family", value: "notoSymbols" },
    { prop: "unicode-range", value: "U+1D2E0-1D2F3" },
  ],
  variable: "--font-noto-symbols-mayan-numerals",
  preload: false,
  adjustFontFallback: false,
});

// Product-only subset (#4410), generated from the original committed face with
// fontTools 4.68.0: pyftsubset input.woff2 --unicodes=U+2318,U+25BE,U+25C6,U+25C7,U+25CF,U+25D0,U+2605,U+2611,U+26A0,U+2713 --flavor=woff2 --no-recalc-timestamp
// Keep fonts.test.ts coverage and the verified binary digest in sync.
const notoSymbolsSymbols = localFont({
  src: [{ path: "./noto-sans-symbols-2-symbols-400.woff2", weight: "400", style: "normal" }],
  declarations: [
    { prop: "font-family", value: "notoSymbols" },
    {
      prop: "unicode-range",
      value: "U+2318, U+25BE, U+25C6, U+25C7, U+25CF, U+25D0, U+2605, U+2611, U+26A0, U+2713",
    },
  ],
  variable: "--font-noto-symbols-symbols",
  preload: false,
  adjustFontFallback: false,
});

const notoSymbolsLatinExt = localFont({
  src: [{ path: "./noto-sans-symbols-2-latin-ext-400.woff2", weight: "400", style: "normal" }],
  declarations: [
    { prop: "font-family", value: "notoSymbols" },
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
  variable: "--font-noto-symbols-latin-ext",
  preload: false,
  adjustFontFallback: false,
});

const notoSymbols = localFont({
  src: [{ path: "./noto-sans-symbols-2-latin-400.woff2", weight: "400", style: "normal" }],
  declarations: [
    { prop: "font-family", value: "notoSymbols" },
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
  variable: "--font-noto-symbols",
  preload: false,
  adjustFontFallback: false,
  fallback: ["'Noto Sans Symbols 2 Fallback'"],
});

/** Every call's variable class, for the root `<html>`. */
export const fontVariables = [
  plexSansCyrillicExt.variable,
  plexSansCyrillic.variable,
  plexSansGreek.variable,
  plexSansVietnamese.variable,
  plexSansLatinExt.variable,
  plexSans.variable,
  plexMonoCyrillicExt.variable,
  plexMonoCyrillic.variable,
  plexMonoVietnamese.variable,
  plexMonoLatinExt.variable,
  plexMono.variable,
  atkinsonLatinExt.variable,
  atkinson.variable,
  notoSymbolsBraille.variable,
  notoSymbolsMath.variable,
  notoSymbolsMayanNumerals.variable,
  notoSymbolsSymbols.variable,
  notoSymbolsLatinExt.variable,
  notoSymbols.variable,
].join(" ");
