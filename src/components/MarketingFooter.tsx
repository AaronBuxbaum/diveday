import { requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { auth } from "@/lib/auth";
import { MarketingFooterView } from "./MarketingFooterView";

export { MarketingFooterView } from "./MarketingFooterView";

/**
 * Reads the negotiated locale (`headers()`-backed, per-request) — stays a
 * plain dynamic Server Component. A marketing page that hoists its own body
 * into a `"use cache"` function wraps this in its own `<Suspense>` with
 * {@link MarketingFooterFallback} instead of nesting it inside the cached
 * scope — see the marketing pages under `src/app`.
 */
export async function MarketingFooter() {
  const [session, locale] = await Promise.all([auth(), requestLocale()]);
  return <MarketingFooterView locale={locale} shopSlug={session?.user?.shopSlug ?? null} />;
}

/**
 * The static shell's stand-in for {@link MarketingFooter} while the
 * negotiated-locale version streams in — the default locale, same content
 * shape, zero streaming delay for the majority of visitors.
 */
export function MarketingFooterFallback() {
  return <MarketingFooterView locale={DEFAULT_DIVER_LOCALE} shopSlug={null} />;
}
