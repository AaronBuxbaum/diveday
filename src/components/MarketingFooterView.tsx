import Link from "next/link";
import { Wordmark } from "@/components/Logo";
import { tapTargetLinkClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";
import { staffShopRoot } from "@/lib/staff-destinations";

/**
 * Every footer link is a 44px target with the control radius, so its focus
 * ring is the nav links' ring and a thumb has the rubric's floor. They were
 * bare 20px words with a square ring on the text (K-19). `min-h-11` is only
 * the height: "About" is 38.8px wide, so each link also carries 8px a side,
 * the nav links' pattern. The row below has no gap and hangs that padding
 * into the gutter with `-mx-2`: the targets are their own spacing, 16px
 * between words and 44px between wrapped lines, the first word on the page
 * gutter and, at lg, the last one on the far gutter.
 */
const footerLinkClass = `${tapTargetLinkClass} rounded-lg px-2 hover:text-foreground hover:underline`;

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
      {/* One row from lg, not sm: tagline and links need 897px side by side,
          and between 640 and ~944 the tagline wrapped and the address dropped
          alone onto a second line (K-133). Below lg they stack. */}
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-6 py-8 text-sm text-muted lg:flex-row lg:items-center lg:justify-between">
        <Wordmark variant="inline"> {t("nav.tagline")}</Wordmark>
        <div className="-mx-2 flex flex-wrap">
          <Link href="/product" className={footerLinkClass}>
            {t("nav.product")}
          </Link>
          <Link href="/pricing" className={footerLinkClass}>
            {t("nav.pricing")}
          </Link>
          <Link href="/switching" className={footerLinkClass}>
            {t("nav.switch")}
          </Link>
          <Link href="/about" className={footerLinkClass}>
            {t("nav.about")}
          </Link>
          {/* The status page shipped on 2026-09-07 with nothing pointing at
              it, and it is `noindex` by design (src/app/status/page.tsx), so
              the only way in was already knowing the URL — which the shop whose
              bookings just broke does not (issue #1475). Beside About, and not
              in the staff chrome: `staff-destinations.ts` is places inside a
              shop. */}
          <Link href="/status" className={footerLinkClass}>
            {t("nav.status")}
          </Link>
          {/* The only route to either legal page from anywhere on the site.
              Both have existed since 2026-08-14 and nothing linked them, so
              they were reachable by typed URL alone -- and the SES
              production-access case names both by URL, which is a claim a
              reviewer checks by looking for the link. */}
          <Link href="/privacy" className={footerLinkClass}>
            {t("nav.privacy")}
          </Link>
          <Link href="/terms" className={footerLinkClass}>
            {t("nav.terms")}
          </Link>
          <Link href={shopSlug ? staffShopRoot(shopSlug) : "/sign-in"} className={footerLinkClass}>
            {shopSlug ? t("nav.goToShop") : t("nav.signIn")}
          </Link>
          <a href={`mailto:${SUPPORT_EMAIL}`} className={footerLinkClass} title={t("nav.sayHello")}>
            {SUPPORT_EMAIL}
          </a>
        </div>
      </div>
    </footer>
  );
}
