/**
 * **The brand's literal hex values, for the four places a CSS token cannot
 * reach.**
 *
 * Everything DiveDay renders styles through semantic tokens (ADR-0004), and
 * this file is the exception the rule needs: a rasterized PNG and a `<meta>`
 * attribute are not stylesheets, so a custom property has nothing to resolve
 * against in either. `scripts/check-tokens.mjs` names this exact path in
 * `exemptPaths`, the same arrangement `src/app/_og/card.tsx` already has.
 *
 * One module rather than a literal at each call site, because the mark was
 * already wrong on all four link-preview cards at once (FU-20260812) by exactly
 * that route. `src/app/globals.css` is the source these mirror, and
 * `src/components/Logo.tsx` is the live SVG that reads the tokens properly.
 */

/** The mark's ground: `--primary` into `--primary-hover`, light mode. */
export const MARK_GRADIENT = "linear-gradient(135deg, #0e7490, #155e75)";

/** The bubbles rising off it — foam, and the one coral highlight. */
export const MARK_FOAM = "#eafcff";
export const MARK_CORAL = "#ff6f61";

/**
 * What colours the browser chrome above the page, per skin.
 *
 * `--surface`, not `--primary`: the staff shell's header is `bg-surface` and
 * sticks to the top, so this is literally the pixel row beneath the status bar
 * on every installed surface. A teal bar over a white header is a seam rather
 * than a brand.
 *
 * Safari reads the `<meta name="theme-color">` this feeds and **not**
 * `manifest.ts`'s `theme_color`, which is why the manifest's value never
 * reached iOS at all before issue #794 — the document carried no such tag.
 */
export const THEME_COLORS = [
  { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  { media: "(prefers-color-scheme: dark)", color: "#0d222d" },
] as const;
