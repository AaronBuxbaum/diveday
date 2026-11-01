import type { LanguageFallback } from "@/i18n/language-labels";
import type { DiverTranslator } from "@/i18n/messages";

/**
 * The acknowledgement shown when the visitor's requested language is not
 * available (review finding I18N-L1).
 *
 * The public header has a language picker (ADR
 * 20260812-reader-chosen-language); this notice explains a fallback when the
 * requested language is unavailable. The locale remains in a cookie, never a
 * `[locale]` route.
 *
 * The tone is the point too. It states what is true (we do not have this
 * language), what is happening (you are reading the shop's), and stops — no
 * apology theatre, no "please use your browser's translator", no suggestion the
 * reader has done something wrong. `fallback.requested` is the language's own
 * endonym, so the reader can recognise the language they requested.
 *
 * A Server Component taking a resolved translator: it renders above the page in
 * the public shop shell, and the bearer-token diver surfaces (`/waivers`,
 * `/ready`, `/recap`, `/claim`) can adopt it with one line each — which is why
 * it lives here rather than inside the `/s/[shopSlug]` layout.
 */
export function LanguageFallbackNotice({
  fallback,
  shopName,
  t,
}: {
  fallback: LanguageFallback;
  shopName: string;
  t: DiverTranslator;
}) {
  return (
    <div className="border-b border-border bg-surface-sunken">
      <div className="mx-auto w-full max-w-6xl px-4 py-2 text-sm text-muted sm:px-6">
        <p>
          {t("shopChrome.languageFallback", {
            requested: fallback.requested,
            shown: fallback.shown,
            shop: shopName,
          })}
        </p>
      </div>
    </div>
  );
}
