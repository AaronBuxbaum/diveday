import { requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { auth } from "@/lib/auth";
import { MarketingFooterView } from "./MarketingFooterView";

/**
 * Reads the session (`auth()`, cookie-backed) and the negotiated locale
 * (`headers()`-backed) — both genuinely per-request and never cacheable, so
 * this stays a plain dynamic Server Component. A marketing page that hoists
 * its own body into a `"use cache"` function (per-locale, no session) wraps
 * this in its own `<Suspense>` with {@link MarketingFooterFallback} instead of
 * nesting it inside the cached scope — see the marketing pages under
 * `src/app`.
 */
export async function MarketingFooter() {
  const [session, locale] = await Promise.all([auth(), requestLocale()]);
  return <MarketingFooterView locale={locale} shopSlug={session?.user?.shopSlug ?? null} />;
}

/**
 * The static shell's stand-in for {@link MarketingFooter} while the real,
 * session-aware footer streams in: the default locale, signed out — correct
 * for the overwhelming majority of marketing-page visitors (anonymous, no
 * session), and what actually renders for them with zero streaming delay.
 */
export function MarketingFooterFallback() {
  return <MarketingFooterView locale={DEFAULT_DIVER_LOCALE} shopSlug={null} />;
}
