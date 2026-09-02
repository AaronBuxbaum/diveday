import {
  type BrandDisplayFontCode,
  brandDisplayFontFamily,
  brandDisplayFontStylesheet,
  brandThemeProperties,
  deriveBrandTheme,
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
}: {
  brandColor: string | null;
  brandDisplayFont: BrandDisplayFontCode | null;
}) {
  if (!brandColor && !brandDisplayFont) return null;
  const declarations: string[] = [];
  if (brandColor) {
    for (const [name, value] of Object.entries(
      brandThemeProperties(deriveBrandTheme(brandColor)),
    )) {
      declarations.push(`${name}:${value}`);
    }
  }
  if (brandDisplayFont) {
    declarations.push(`--brand-display:${brandDisplayFontFamily(brandDisplayFont)}`);
  }
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
      <style data-brand-style="">{`:root{${declarations.join(";")}}`}</style>
    </>
  );
}
