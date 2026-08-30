import { enterDemoAction } from "@/app/actions/demo";
import { MarketingNavView } from "@/components/MarketingNavView";
import { requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { auth } from "@/lib/auth";

/**
 * Reads the session (`auth()`, cookie-backed) and the negotiated locale
 * (`headers()`-backed) — both genuinely per-request and never cacheable, so
 * this stays a plain dynamic Server Component. A marketing page that hoists
 * its own body into a `"use cache"` function (per-locale, no session) wraps
 * this in its own `<Suspense>` with {@link MarketingNavFallback} instead of
 * nesting it inside the cached scope — see the marketing pages under
 * `src/app`.
 */
export async function MarketingNav({
  hideCta = false,
  compactMobile = false,
}: { hideCta?: boolean; compactMobile?: boolean } = {}) {
  const session = await auth();
  const locale = await requestLocale();
  return (
    <MarketingNavView
      shopSlug={session?.user?.shopSlug ?? null}
      locale={locale}
      hideCta={hideCta}
      compactMobile={compactMobile}
      demoAction={enterDemoAction}
    />
  );
}

/**
 * The static shell's stand-in for {@link MarketingNav} while the real,
 * session-aware nav streams in: the default locale, signed out — correct for
 * the overwhelming majority of marketing-page visitors (anonymous, no
 * session), and what actually renders for them with zero streaming delay.
 */
export function MarketingNavFallback({
  hideCta = false,
  compactMobile = false,
}: { hideCta?: boolean; compactMobile?: boolean } = {}) {
  return (
    <MarketingNavView
      shopSlug={null}
      locale={DEFAULT_DIVER_LOCALE}
      hideCta={hideCta}
      compactMobile={compactMobile}
      demoAction={enterDemoAction}
    />
  );
}
