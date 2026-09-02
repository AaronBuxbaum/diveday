import {
  BRAND_DARK_GROUND,
  BRAND_DARK_INK,
  BRAND_DEFAULT_SURFACE,
  BRAND_INK,
  type BrandDisplayFontCode,
  brandDisplayFontFamily,
  brandDisplayFontStylesheet,
  DIVEDAY_BRAND_COLOR,
  deriveBrandTheme,
  deriveDarkBrandTheme,
  isBrandDisplayFontCode,
} from "@/lib/brand";

/**
 * **What the shop's brand reads as, before it opens the storefront.**
 *
 * Until 2026-09-02 a shop learned what its colour and face looked like by
 * saving and opening its public page — the one surface in Settings where the
 * fact being edited was invisible on the form. This strip is that fact: the
 * shop's name in the chosen face, on the derived fill, with the ink the rule
 * chose for it, once by day and once at night. It is rendered from the same
 * pure derivation the storefront runs (`deriveBrandTheme`,
 * `deriveDarkBrandTheme`), so it cannot show a colour the storefront will not.
 *
 * It reads the *saved* colour, not the field: the picker beside it is a plain
 * form control and the derivation runs on the server. A live preview would
 * mean running the contrast rule in the browser, which is a second copy of
 * the one rule the ADR keeps in one place; saving is one tap away.
 *
 * The face is loaded here exactly as the storefront loads it — one Google
 * Fonts stylesheet for the chosen family — and only when a family is chosen;
 * with none, the sample is Geist, which is what the storefront shows too.
 */
export function BrandPreview({
  shopName,
  brandColor,
  brandDisplayFont,
  label,
  nightLabel,
}: {
  shopName: string;
  brandColor: string | null;
  brandDisplayFont: string | null;
  label: string;
  nightLabel: string;
}) {
  const color = brandColor ?? DIVEDAY_BRAND_COLOR;
  const day = deriveBrandTheme(color);
  const night = deriveDarkBrandTheme(color);
  const face: BrandDisplayFontCode | null = isBrandDisplayFontCode(brandDisplayFont)
    ? brandDisplayFont
    : null;
  const fontFamily = face ? brandDisplayFontFamily(face) : undefined;
  return (
    <figure className="mt-2">
      {face ? (
        <link rel="stylesheet" href={brandDisplayFontStylesheet(face)} precedence="brand-font" />
      ) : null}
      <figcaption className="text-sm font-medium text-muted">{label}</figcaption>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {[
          { theme: day, ground: BRAND_DEFAULT_SURFACE, ink: BRAND_INK, caption: null },
          { theme: night, ground: BRAND_DARK_GROUND, ink: BRAND_DARK_INK, caption: nightLabel },
        ].map(({ theme, ground, ink, caption }) => (
          <div
            key={ground}
            // The storefront's own grounds, from the derivation's constants
            // rather than the staff page's tokens: a staffer reading Settings
            // at night still sees the day tile as the day tile.
            style={{ backgroundColor: ground, color: ink }}
            className="flex min-h-24 flex-col justify-between gap-3 rounded-inset border border-border p-4"
          >
            <p className="text-xl font-semibold tracking-tight text-balance" style={{ fontFamily }}>
              {shopName}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex min-h-9 items-center rounded-lg px-3 text-sm font-medium"
                style={{ backgroundColor: theme.primary, color: theme.primaryForeground }}
              >
                Aa
              </span>
              <span
                className="inline-flex min-h-9 items-center rounded-lg px-3 text-sm font-medium"
                style={{ backgroundColor: theme.primaryTint, color: theme.primary }}
              >
                Aa
              </span>
              {caption ? <span className="ms-auto text-xs opacity-70">{caption}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}
