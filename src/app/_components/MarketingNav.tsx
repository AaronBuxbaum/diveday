import { enterDemoAction } from "@/app/actions/demo";
import { MarketingNavView } from "@/components/MarketingNavView";
import { requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE, type DiverLocale } from "@/i18n/settings";
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
export async function MarketingNav({ locale: knownLocale }: { locale?: DiverLocale } = {}) {
  // Every request read starts before the session's database round trip. Once
  // a response closes, Next moves its request store to the `after` phase and
  // refuses `cookies()` there as a read "inside `after()`"; a locale read
  // queued behind the session could land in it (the root not-found's nav on
  // `/ready/[token]`, logged on every e2e run). A caller that has already
  // negotiated the locale passes it in.
  const [session, locale] = await Promise.all([auth(), knownLocale ?? requestLocale()]);
  return (
    <MarketingNavView
      shopSlug={session?.user?.shopSlug ?? null}
      locale={locale}
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
export function MarketingNavFallback() {
  return (
    <MarketingNavView
      shopSlug={null}
      locale={DEFAULT_DIVER_LOCALE}
      pending
      demoAction={enterDemoAction}
    />
  );
}
