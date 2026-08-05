import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE, type DiverLocale } from "@/i18n/settings";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";

/**
 * Reads the negotiated locale (`headers()`-backed, per-request) — stays a
 * plain dynamic Server Component. A marketing page that hoists its own body
 * into a `"use cache"` function wraps this in its own `<Suspense>` with
 * {@link MarketingFooterFallback} instead of nesting it inside the cached
 * scope — see the marketing pages under `src/app`.
 */
export async function MarketingFooter() {
  const locale = await requestLocale();
  return <MarketingFooterView locale={locale} />;
}

/**
 * The static shell's stand-in for {@link MarketingFooter} while the
 * negotiated-locale version streams in — the default locale, same content
 * shape, zero streaming delay for the majority of visitors.
 */
export function MarketingFooterFallback() {
  return <MarketingFooterView locale={DEFAULT_DIVER_LOCALE} />;
}

function MarketingFooterView({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-6 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2">
          <LogoMark className="size-4 shrink-0 text-primary" />
          <span>
            {/* i18n-exempt: brand name */}
            <span className="font-semibold text-foreground">DiveDay.</span> {t("nav.tagline")}
          </span>
        </p>
        <div className="flex flex-wrap gap-4">
          <Link href="/product" className="hover:text-foreground hover:underline">
            {t("nav.product")}
          </Link>
          <Link href="/pricing" className="hover:text-foreground hover:underline">
            {t("nav.pricing")}
          </Link>
          <Link href="/switching" className="hover:text-foreground hover:underline">
            {t("nav.switch")}
          </Link>
          <Link href="/about" className="hover:text-foreground hover:underline">
            {t("nav.about")}
          </Link>
          <Link href="/sign-in" className="hover:text-foreground hover:underline">
            {t("nav.signIn")}
          </Link>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="hover:text-foreground hover:underline"
            title={t("nav.sayHello")}
          >
            {SUPPORT_EMAIL}
          </a>
        </div>
      </div>
    </footer>
  );
}
