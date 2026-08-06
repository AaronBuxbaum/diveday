import type { LanguageFallback } from "@/i18n/language-labels";
import type { DiverTranslator } from "@/i18n/messages";

/**
 * "DiveDay isn't in Deutsch yet. This page is in English, the language Blue
 * Mantis works in." — the acknowledgement a diver gets when their language is
 * one DiveDay does not carry (review finding I18N-L1).
 *
 * **Not a language switcher, and it must never grow into one.** DiveDay has no
 * switcher and no `[locale]` route by design (docs ADR
 * 20260729-diver-copy-localization): the locale is a property of the shop row
 * and of the visitor's own device, not of a control on the page. The gap that
 * decision left is narrower than "no choice" — it is *no signal*. A diver whose
 * device asks for German silently receives the shop's language and has no way
 * to tell a deliberate policy from a broken page. One slim line closes that
 * without offering a choice that does not exist.
 *
 * The tone is the point too. It states what is true (we do not have this
 * language), what is happening (you are reading the shop's), and stops — no
 * apology theatre, no "please use your browser's translator", no suggestion the
 * reader has done something wrong. `fallback.requested` is the language's own
 * endonym, so the one word a non-reader can recognise is in there.
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
