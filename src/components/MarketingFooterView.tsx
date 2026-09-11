import Link from "next/link";
import { Wordmark } from "@/components/Logo";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";
import { staffShopRoot } from "@/lib/staff-destinations";

export function MarketingFooterView({
  locale,
  shopSlug,
}: {
  locale: DiverLocale;
  shopSlug: string | null;
}) {
  const t = diverTranslator(locale);
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-6 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <Wordmark variant="inline"> {t("nav.tagline")}</Wordmark>
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
          {/* The status page shipped on 2026-09-07 with nothing pointing at
              it, and it is `noindex` by design (src/app/status/page.tsx), so
              the only way in was already knowing the URL — which the shop whose
              bookings just broke does not (issue #1475). Beside About, and not
              in the staff chrome: `staff-destinations.ts` is places inside a
              shop. */}
          <Link href="/status" className="hover:text-foreground hover:underline">
            {t("nav.status")}
          </Link>
          {/* The only route to either legal page from anywhere on the site.
              Both have existed since 2026-08-14 and nothing linked them, so
              they were reachable by typed URL alone -- and the SES
              production-access case names both by URL, which is a claim a
              reviewer checks by looking for the link. */}
          <Link href="/privacy" className="hover:text-foreground hover:underline">
            {t("nav.privacy")}
          </Link>
          <Link href="/terms" className="hover:text-foreground hover:underline">
            {t("nav.terms")}
          </Link>
          <Link
            href={shopSlug ? staffShopRoot(shopSlug) : "/sign-in"}
            className="hover:text-foreground hover:underline"
          >
            {shopSlug ? t("nav.goToShop") : t("nav.signIn")}
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
