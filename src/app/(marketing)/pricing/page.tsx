import { cacheLife } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { Eyebrow } from "@/app/_components/Eyebrow";
import { ClosingCta, FunnelCtas } from "@/app/_components/FunnelCtas";
import { JsonLd } from "@/components/JsonLd";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { MarketingSectionMotion } from "@/components/MarketingReveal";
import { MarginNotes } from "@/components/MarketingSections";
import { buttonClass } from "@/components/ui/button";
import { BANNER_TITLE_CLASS, DISPLAY_TITLE_CLASS } from "@/components/ui/typography";
import { FEE_ASSUMPTIONS } from "@/features/money/fee-comparison";
import { requestPricingOffer } from "@/features/money/pricing-offer";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import type { DiverLocale } from "@/i18n/settings";
import type { PlanTerms } from "@/lib/billing/pricing-plans";
import { formatMoneyScanned } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import { earlyAccessPrice } from "@/lib/marketing";
import { getMigrationGuide, MIGRATION_GUIDES } from "@/lib/migration-guides";
import { FeeComparison } from "./_components/FeeComparison";
import { PricingExportBand } from "./_components/PricingExportBand";
import { offerFigure, pricingFaq } from "./faq";

// `instant = true`: navigating here paints immediately. The request-scoped
// read this page makes (`requestLocale()`) sits behind this segment's
// `loading.tsx` — the boundary of record for a page — so the frame lands
// without waiting on the request. `next build` audits the claim. See ADR
// 20260804-instant-navigation.
export const instant = true;

export { generateMetadata } from "./metadata";

/** The marketing shell's container, the nav's and the footer's: one left edge (B12). */
const CONTAINER = "mx-auto w-full max-w-7xl px-6";

/**
 * The body renders **once**, in the reader's own language — see `ProductPage`
 * for the whole story. In short: the fallback used to be a second, English
 * render of this entire page, and swapping it out for the negotiated-locale
 * one tore down and rebuilt the subtree, discarding whatever the visitor had
 * already done to it (FU-20260812-marketing-suspense-swap-discards-interaction).
 * The instant paint now comes from this segment's `loading.tsx`, which has
 * nothing interactive in it to lose.
 */
export default async function PricingPage() {
  const [locale, offer] = await Promise.all([requestLocale(), requestPricingOffer()]);
  return (
    <div className="flex flex-1 flex-col">
      <PricingBody locale={locale} offer={offer} />
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </div>
  );
}

/**
 * Cached per negotiated locale (DIVER_LOCALES — two entries) and per offer:
 * the configured offer and its numbers (ADR 20261022-pricing-ab-test), so a changed
 * `PRICING_*` value is a new cache entry. No session-scoped content.
 */
async function PricingBody({ locale, offer }: { locale: DiverLocale; offer: PlanTerms }) {
  "use cache";
  cacheLife("max");
  const t = diverTranslator(locale);
  const { figure, cadence, params } = offerFigure(t, offer, locale);
  // Generated from the migration-guides registry, never hand-listed, so a new
  // guide can't be silently omitted from this answer.
  const competitors = cachedListFormat(locale, { type: "conjunction" }).format(
    MIGRATION_GUIDES.map((guide) => guide.competitor),
  );

  /**
   * The comparison against FareHarbor (Aaron, 2026-11-18, replacing the old "no figure
   * for what a shop pays in practice" rule), counted the same way, software fee plus card processing, off `src/lib/fee-comparison.ts`.
   * Every figure is labelled an estimate beside its source and the date it was
   * checked, and each links to the switching guide that carries the citations
   * (docs/product/marketing.md: competitor statements are documented fact, an
   * unpublished fee is never stated as a published price). Rows come from the
   * guide registry, so a de-registered guide drops its link.
   */
  const fareHarborGuide = getMigrationGuide("fareharbor");
  const comparison = {
    sliderLabel: t("marketing.pricing.compare.sliderLabel"),
    subscription: t("marketing.pricing.compare.lines.subscription"),
    free: t("marketing.pricing.compare.lines.free"),
    bookingFee: t("marketing.pricing.compare.lines.bookingFee"),
    otaFee: t("marketing.pricing.compare.lines.otaFee"),
    processing: t("marketing.pricing.compare.lines.processing"),
    total: t("marketing.pricing.compare.lines.total"),
    otaFootnote: t("marketing.pricing.compare.otaFootnote", { share: "{share}" }),
    otaSource: t("marketing.pricing.compare.otaSource"),
    totalNote: t("marketing.pricing.compare.totalNote", { percent: "{percent}" }),
    systems: {
      fareharbor: {
        name: fareHarborGuide?.competitor ?? "FareHarbor", // i18n-exempt: a product name
        estimated: t("marketing.pricing.compare.systems.fareharbor.estimated"),
      },
      diveday: {
        name: "DiveDay", // i18n-exempt: our product name
      },
    },
  };

  const faq = pricingFaq(t, competitors, offer, locale);

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };

  return (
    <>
      <JsonLd data={faqJsonLd} />
      <main className="flex-1">
        <MarketingSectionMotion />
        {/* The price is the hero, then the invoice beside its one list of
            notes, then the pair with the terms under it (visual review
            2026-10-24, B11). Every band sits in the marketing shell's
            container (`max-w-7xl px-6`, the nav's and the footer's), so the
            page has one left edge (B12); a prose band keeps its measure inside
            it rather than centring its own. */}
        <section className="border-b border-border">
          <div className={`${CONTAINER} pt-20 pb-16 lg:pt-28 lg:pb-20`}>
            {/* The spaces around the separator are load-bearing: the middot
                is `aria-hidden`, and without them the accessible name runs
                the two words together. */}
            <Eyebrow>
              {t(earlyAccessPrice.nameKey)}{" "}
              <span aria-hidden="true" className="mx-1 text-border-strong">
                ·
              </span>{" "}
              {t("marketing.pricing.earlyAccessBadge")}
            </Eyebrow>
            <h1 className={`mt-5 ${DISPLAY_TITLE_CLASS} sm:text-5xl`}>
              {t("marketing.pricing.heroTitle")}
            </h1>
            <p className="mt-10 text-7xl leading-none font-semibold tracking-[-0.06em] sm:text-8xl">
              {figure}
            </p>
            <p className="mt-4 text-base text-muted">{cadence}</p>
            {/* The one-year lock, under the figure it is about (H-20260724-public-founding-shop-price). It
                names its subject so a burned reader cannot read "I am" into
                it. */}
            <p className="mt-2 text-sm leading-6 text-pretty text-muted">
              {t("marketing.pricing.lockNote")}
            </p>

            <FunnelCtas locale={locale} source="pricing" footnotes={{}} className="mt-10" />
          </div>
        </section>

        {/* The comparison: one slider, two columns counted the same way, and the
            sources and assumptions written beside the figures (docs/product/marketing.md,
            claims policy). DiveDay's column is the only one in full ink. */}
        <section className="border-b border-border" aria-labelledby="compare-fees">
          <div className={`${CONTAINER} py-16 lg:py-24`}>
            <h2 id="compare-fees" className={`${BANNER_TITLE_CLASS} sm:text-4xl`}>
              {t("marketing.pricing.compare.title")}
            </h2>
            <p className="mt-4 max-w-2xl leading-7 text-muted">
              {t("marketing.pricing.compare.lede")}
            </p>
            <FeeComparison locale={locale} diveDay={offer} labels={comparison} />
            <details className="mt-5 max-w-3xl text-sm">
              <summary className="cursor-pointer font-medium">
                {t("marketing.pricing.compare.assumptionsTitle")}
              </summary>
              <p className="mt-2 text-xs leading-5 text-muted">
                {t("marketing.pricing.compare.assumptions", {
                  sale: formatMoneyScanned(FEE_ASSUMPTIONS.averageSaleCents, "usd", locale),
                })}
              </p>
            </details>
            {fareHarborGuide ? (
              <Link
                href={`/switching/${fareHarborGuide.slug}`}
                className={buttonClass({
                  variant: "link",
                  arrow: true,
                  flush: true,
                  className: "mt-4 text-start",
                })}
              >
                {t("marketing.pricing.compare.guideLink", {
                  competitor: fareHarborGuide.competitor,
                })}
              </Link>
            ) : null}
          </div>
        </section>

        {/* The notes: what the comparison cannot say, one short list, below the
            numbers it qualifies. */}
        <section className="border-b border-border" aria-label={t("marketing.pricing.notes.title")}>
          <div className={`${CONTAINER} py-12 lg:py-16`}>
            <div className="max-w-2xl">
              <Eyebrow as="h2">{t("marketing.pricing.notes.title")}</Eyebrow>
              <MarginNotes
                className="mt-4"
                notes={[
                  t("marketing.pricing.notes.note1"),
                  t("marketing.pricing.notes.note2"),
                  ...earlyAccessPrice.includedKeys.map((key) => t(key)),
                  // The try-it-on-one-trip line (Aaron, 2026-11-24): its fee
                  // comes from the configured offer, never a figure in the
                  // bundle (ADR 20261124-free-shops-no-trial).
                  t("marketing.pricing.priceNote", params),
                ]}
              />
              <Link
                href="/product"
                className={buttonClass({
                  variant: "link",
                  arrow: true,
                  flush: true,
                  className: "mt-4",
                })}
              >
                {t("marketing.pricing.seeFullList")}
              </Link>
            </div>
          </div>
        </section>

        <PricingExportBand locale={locale} />

        {/* The objection layer: two columns of plain Q&A, only the questions
            the table and the notes do not answer (B11). Answers stay in the
            document; they are also the FAQPage structured data above. */}
        <section className={`${CONTAINER} py-16 lg:py-24`}>
          <h2 className={`${BANNER_TITLE_CLASS} sm:text-4xl`}>{t("marketing.pricing.faqTitle")}</h2>
          <div className="mt-10 grid gap-x-14 gap-y-10 md:grid-cols-2">
            {faq.map((item) => (
              <article key={item.question}>
                <h3 className="font-semibold leading-6">{item.question}</h3>
                <p className="mt-2 leading-7 text-muted">{item.answer}</p>
                {item.link ? (
                  <Link
                    href={item.link.href}
                    className={buttonClass({
                      variant: "link",
                      arrow: true,
                      flush: true,
                      className: "mt-1 text-start",
                    })}
                  >
                    {item.link.label}
                  </Link>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <ClosingCta
          locale={locale}
          source="pricing-close"
          title={t("marketing.pricing.closingTitle")}
        />
      </main>
    </>
  );
}
