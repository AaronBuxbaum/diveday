import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { Eyebrow } from "@/app/_components/Eyebrow";
import { ClosingCta, FunnelCtas } from "@/app/_components/FunnelCtas";
import { MarketingNav, MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { MarketingSectionMotion } from "@/components/MarketingReveal";
import { FeatureDirectory } from "@/components/MarketingSections";
import { buttonClass } from "@/components/ui/button";
import { DISPLAY_TITLE_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import type { DiverLocale } from "@/i18n/settings";
import type { PlanTerms } from "@/lib/billing/pricing-plans";
import { switchingHref } from "@/lib/funnel";
import { sharedLinkCard } from "@/lib/marketing";
import { requestPricingOffer } from "@/lib/pricing-arm-request";

// `instant = true`: navigating here paints immediately. The request-scoped
// read this page makes (`requestLocale()`) sits behind this segment's
// `loading.tsx` — the boundary of record for a page — so the frame lands
// without waiting on the request. `next build` audits the claim. See ADR
// 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Dive shop software features — DiveDay",
  description:
    "Every DiveDay feature for dive shops, each with its own page: online booking, waivers and medical forms, certification checks, check-in, the boat manifest, rental gear, courses and payments.",
  alternates: { canonical: "/product" },
  openGraph: {
    ...sharedLinkCard,
    title: "DiveDay features, from the first booking to the roll call",
    description:
      "Each feature has its own page, with the screen that does the job and the demo opened on it.",
    url: "/product",
  },
  // `summary_large_image`: the OG block above names the shared card via
  // `sharedLinkCard`; its image is served at `src/app/link-card/route.tsx`
  // (docs/product/marketing.md, Twitter-card policy). Title and
  // description are restated here rather than left to inherit, so a shared link
  // never unfurls with the root layout's generic site-level words.
  twitter: {
    card: "summary_large_image",
    title: "DiveDay features, from the first booking to the roll call",
    description:
      "Each feature has its own page, with the screen that does the job and the demo opened on it.",
  },
};

/**
 * The body renders **once**, in the reader's own language.
 *
 * Until 2026-08-14 this page wrapped the body in a `<Suspense>` whose fallback
 * was `<ProductBody locale={DEFAULT_DIVER_LOCALE} />` — the whole page, a
 * second time, in English. That bought the instant paint, and it cost the
 * visitor everything they did before the negotiated-locale body resolved: a
 * replaced subtree carries no DOM state over, so a tap on the chapter strip
 * the page had then scrolled to a heading in a subtree that was about to be
 * thrown away, and an `es-ES` reader landed somewhere else on the page (the
 * Spanish chapters above it were taller). It was invisible in every en-US
 * screenshot and assertion, because both renders were the same words
 * (FU-20260812-marketing-suspense-swap-discards-interaction).
 *
 * The paint is still instant, and it is `loading.tsx` — this segment's
 * `<Suspense>` boundary, the arrangement ADR 20260804-instant-navigation
 * already establishes — that makes it so. Nothing in that skeleton is
 * interactive, so there is nothing to lose when the real body lands. The nav
 * keeps its own boundary because it reads the *session* as well as the locale;
 * the body must not wait on that.
 */
export default async function ProductPage() {
  const [locale, offer] = await Promise.all([requestLocale(), requestPricingOffer()]);
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
      <ProductBody locale={locale} offer={offer} />
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </div>
  );
}

/** Cached per negotiated locale (DIVER_LOCALES — two entries) and pricing offer — no session-scoped content. */
async function ProductBody({ locale, offer }: { locale: DiverLocale; offer: PlanTerms }) {
  "use cache";
  cacheLife("max");
  const t = diverTranslator(locale);

  return (
    <main className="flex-1">
      <MarketingSectionMotion />
      {/* The hero, left-aligned on the directory's own column and open at
          the bottom: no rule and no band boundary between the promise and the
          list that keeps it, so the title, the lede and the three phases share
          one left edge (design review, 2026-10-05). It was centred over a
          left-aligned grid, with a rule and 213px of air between them, and
          read as two bands. */}
      <section>
        <div className="mx-auto max-w-6xl px-6 pt-8 pb-10 lg:pt-16">
          <Eyebrow>{t("marketing.product.eyebrow")}</Eyebrow>
          <h1 className={`mt-4 max-w-4xl ${DISPLAY_TITLE_CLASS} sm:text-6xl`}>
            {t("marketing.product.heroTitle")}
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">
            {t("marketing.product.heroDescription")}
          </p>
          {/* The nav tap that lands here is the most evaluation-intent click
              on the site; without its own CTA the first offered action was
              the nav's trial link — the wrong ask while a buyer is still
              verifying claims. Same one-primary block as the home hero. */}
          <FunnelCtas
            locale={locale}
            source="product"
            hero
            footnotes={{ offer }}
            className="mt-6"
          />
        </div>
      </section>

      {/* The directory: every feature page, under the part of a shop's year it
          serves, and since review on 2026-10-05 the full list as well. It is
          the page's one idea (docs/design/surfaces.md, "/product"): a shop
          owner arrives asking whether DiveDay does their job, finds the job by
          its name, and reaches its page in one tap, or opens the row to read
          everything the page holds. The rows come off the registry
          (`src/lib/feature-pages.ts`), so a page added there is listed here
          and on the homepage without either page naming it. The phases are
          this page's sections, so they are its `h2`s.

          **The reference index lives in the rows now.** It was a band of its
          own, one closed disclosure per group set like a spec sheet
          (2026-09-17), and once each group became a feature page's checklist
          its first twelve rows repeated the directory's twelve names one band
          down. Each row's disclosure is that page's "What's in it" list, word
          for word, and the three groups no page owns close the directory.
          `#full-list` is where the homepage's "full list" link lands, so it
          never arrives on this hero instead. The closing sentence counts every
          line off the registry, so the total can never drift from the rows.

          The `product-index` demo door that closed the old band went with it:
          on a page this short it stood 880px above the close's pair, the
          pressure that retired `home-mid`. */}
      <section id="full-list" className="mx-auto max-w-6xl scroll-mt-10 px-6 pb-20 lg:pb-24">
        <FeatureDirectory locale={locale} headingLevel="h2" lines />
        {/* The sections' names, never a count of the rows (B44), and the
            export promise as a link to the one place it is written (B10). */}
        <p className="mt-12 max-w-2xl text-lg leading-8 text-muted">
          {t("marketing.product.boxDescription")}
        </p>
        <div className="mt-4 flex flex-col items-start gap-1">
          <Link
            href="/pricing#export"
            className={buttonClass({ variant: "link", flush: true, className: "text-start" })}
          >
            {t("marketing.common.recordsLink")}
          </Link>
          {/* Tagged, like the homepage's doors onto the same surface. */}
          <Link
            href={switchingHref("/switching/spreadsheet", "product-spreadsheet")}
            className={buttonClass({ variant: "link", flush: true, className: "text-start" })}
          >
            {t("marketing.product.spreadsheetLink")}
          </Link>
        </div>
      </section>

      <ClosingCta locale={locale} source="product" title={t("marketing.product.closingTitle")} />
    </main>
  );
}
