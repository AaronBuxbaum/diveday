import {
  type BrandDisplayFontCode,
  brandDisplayFontFamily,
  brandDisplayFontStylesheet,
  brandThemeProperties,
  deriveBrandTheme,
  deriveDarkBrandTheme,
} from "@/lib/brand";

/**
 * **The shop's brand, emitted as tokens** (Harbor — ADR
 * 20260901-diveday-reimagined, decision 2).
 *
 * One `<style>` that re-points the four action tokens the public primitives
 * already read — `--primary`, `--primary-hover`, `--primary-tint`,
 * `--primary-foreground` (plus the focus ring, which follows the fill) — at the
 * shop's colour, derived and contrast-checked by `deriveBrandTheme`, and one
 * `--brand-display` that the `font-brand-display` utility resolves for
 * headings. Nothing else moves: ink, ground, borders and every signal colour
 * stay DiveDay's, which is what keeps a status, a manifest or a waiver from
 * ever wearing the shop's colour. `BrandStyle.test.tsx` pins that the emitted
 * block names no token but those.
 *
 * **Two blocks, one colour.** A `:root` block for the light scheme and a second
 * inside `@media (prefers-color-scheme: dark)`, from `deriveDarkBrandTheme` —
 * because this `<style>` renders after globals.css and a media query adds no
 * specificity, so a single `:root` block wins in *both* schemes and a branded
 * storefront wore its light-mode colour at depth, at ~3:1 (issue #1265). The
 * media query is the whole mechanism: `data-theme` appears nowhere in
 * globals.css, and the dark palette lives only behind that query. The three
 * skins that redeclare `--primary` on a *class* — boat mode, glare mode, print
 * — still win over both blocks on specificity, which is right: each is a
 * deliberate override of the shop's colour for a reader who asked for it.
 *
 * A shop with no brand set renders nothing, and the storefront wears DiveDay's
 * own tokens — the brand is an overlay with a default, never a requirement.
 * The chosen face loads from Google Fonts by one `<link>`, which React hoists
 * into the head; `src/lib/content-security-policy.ts` admits exactly those two
 * hosts for it. The values here are a checked `#rrggbb` and a family from a
 * closed list, so the block is safe to render as text.
 */
export function BrandStyle({
  brandColor,
  brandDisplayFont,
  hostFont = null,
}: {
  brandColor: string | null;
  brandDisplayFont: BrandDisplayFontCode | null;
  /**
   * The host page's own `font-family`, for an embed that inherits its page
   * (validated by `parseEmbedFontParam`): it becomes the body face *and* the
   * heading face, so the widget reads as part of the site it sits in. Never
   * set on the storefront itself.
   */
  hostFont?: string | null;
}) {
  if (!brandColor && !brandDisplayFont && !hostFont) return null;
  const declarations: string[] = [];
  if (brandColor) {
    for (const [name, value] of Object.entries(
      brandThemeProperties(deriveBrandTheme(brandColor)),
    )) {
      declarations.push(`${name}:${value}`);
    }
  }
  if (hostFont) {
    declarations.push(`--font-sans:${hostFont}`, `--brand-display:${hostFont}`);
  } else if (brandDisplayFont) {
    declarations.push(`--brand-display:${brandDisplayFontFamily(brandDisplayFont)}`);
  }
  // The dark scheme's own derivation of the same colour. Only the colour
  // tokens repeat — the display face is a face in both schemes.
  const darkDeclarations = brandColor
    ? Object.entries(brandThemeProperties(deriveDarkBrandTheme(brandColor))).map(
        ([name, value]) => `${name}:${value}`,
      )
    : [];
  const css = darkDeclarations.length
    ? `:root{${declarations.join(";")}}@media(prefers-color-scheme:dark){:root{${darkDeclarations.join(";")}}}`
    : `:root{${declarations.join(";")}}`;
  return (
    <>
      {brandDisplayFont ? (
        <link
          rel="stylesheet"
          href={brandDisplayFontStylesheet(brandDisplayFont)}
          // React hoists a stylesheet with a precedence into <head> once.
          precedence="brand-font"
        />
      ) : null}
      <style data-brand-style="">{css}</style>
    </>
  );
}
