import { cacheLife } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { Eyebrow } from "@/app/_components/Eyebrow";
import { ClosingCta, FunnelCtas } from "@/app/_components/FunnelCtas";
import { MarketingNav, MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { MarketingSectionMotion } from "@/components/MarketingReveal";
import { MarginNotes } from "@/components/MarketingSections";
import { buttonClass } from "@/components/ui/button";
import { BANNER_TITLE_CLASS, DISPLAY_TITLE_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import type { DiverLocale } from "@/i18n/settings";
import type { PlanTerms } from "@/lib/billing/pricing-plans";
import { cachedListFormat } from "@/lib/intl-cache";
import { earlyAccessPrice } from "@/lib/marketing";
import { getMigrationGuide, MIGRATION_GUIDES } from "@/lib/migration-guides";
import { ONBOARDING_EMAIL } from "@/lib/platform-mail";
import { requestPricingOffer } from "@/lib/pricing-arm-request";
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
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
      <PricingBody locale={locale} offer={offer} />
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </div>
  );
}

/**
 * Cached per negotiated locale (DIVER_LOCALES — two entries) and per offer:
 * the pricing arm and its numbers (ADR 20261022-pricing-ab-test), so a changed
 * `PRICING_*` value is a new cache entry. No session-scoped content.
 */
async function PricingBody({ locale, offer }: { locale: DiverLocale; offer: PlanTerms }) {
  "use cache";
  cacheLife("max");
  const t = diverTranslator(locale);
  // The percent arm's own lines replace every flat-only one: the figure, its
  // cadence, the invoice's "cut" row, the anchor's answer and the closing line.
  const percentArm = offer.plan === "percent_of_volume";
  const { params, figure, cadence } = offerFigure(t, offer, locale);
  // Generated from the migration-guides registry, never hand-listed, so a new
  // guide can't be silently omitted from this answer.
  const competitors = cachedListFormat(locale, { type: "conjunction" }).format(
    MIGRATION_GUIDES.map((guide) => guide.competitor),
  );

  /**
   * The anchor a flat price needs: the other pricing model a dive shop is
   * actually offered. Both rows restate what the incumbent itself publishes —
   * or, for FareHarbor, that it publishes nothing and the figure is a
   * third-party report — and each links to the switching guide that carries the
   * citations (docs/product/marketing.md: competitor statements are documented
   * fact, and an unpublished fee is never stated as a published price).
   *
   * Deliberately absent: any figure for what a shop pays in practice, any
   * per-booking volume, and any arithmetic comparing the two. We have no
   * customers, so we have no basis for either, and inventing one to make the
   * flat price look better is the exact failure the claims policy exists to
   * stop. Rows are derived from the guide registry, so a de-registered guide
   * drops its row rather than leaving a dead link on the pricing page.
   */
  const rezdyGuide = getMigrationGuide("rezdy");
  const fareHarborGuide = getMigrationGuide("fareharbor");
  const channelFees = [
    rezdyGuide && {
      guide: rezdyGuide,
      claim: t("marketing.pricing.feeAnchor.rezdy", { competitor: rezdyGuide.competitor }),
    },
    fareHarborGuide && {
      guide: fareHarborGuide,
      claim: t("marketing.pricing.feeAnchor.fareharbor", {
        competitor: fareHarborGuide.competitor,
      }),
    },
  ].flatMap((row) => (row ? [row] : []));

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
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD structured data built from our own constants above and `<`-escaped below.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c"),
        }}
      />
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
            {/* The two-year lock, under the figure it is about (H-12). It
                names its subject so a burned reader cannot read "I am" into
                it. */}
            <p className="mt-2 text-sm leading-6 text-pretty text-muted">
              {t("marketing.pricing.lockNote")}
            </p>

            {/* **The annotated invoice** (docs/design/brand.md: `/pricing` is
                the one page whose screen is a bill). Every row is a word, never
                a figure: the price is the display figure above, H-12's single
                source. The leaving row points down to the export band
                (`#export`), the one place on the page the promise is written
                in full, beside the screen it describes (B10, and its review:
                the sentence was here too, 900 px above itself). `#export` is
                where every other page's "Taking your records with you" lands. */}
            <div className="mt-12 grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
              <dl
                aria-label={t("marketing.pricing.invoice.title")}
                className="divide-y divide-border border-y border-border"
              >
                {(["setup", "logins", "tiers", "cut", "cards", "contract", "leaving"] as const).map(
                  (row) => (
                    <div
                      key={row}
                      className="flex flex-wrap items-baseline justify-between gap-x-6 py-3 text-sm leading-6"
                    >
                      <dt className="text-muted">
                        {percentArm && row === "cut"
                          ? t("marketing.pricing.percentArm.invoiceFeeLabel")
                          : t(`marketing.pricing.invoice.${row}.label`)}
                      </dt>
                      <dd className="text-end font-medium">
                        {percentArm && row === "cut"
                          ? t("marketing.pricing.percentArm.invoiceFeeValue", params)
                          : t(`marketing.pricing.invoice.${row}.value`)}
                      </dd>
                      {row === "leaving" ? (
                        <dd className="mt-1 basis-full">
                          <a
                            href="#export"
                            className={buttonClass({ variant: "link", size: "sm", flush: true })}
                          >
                            {t("marketing.pricing.invoice.leaving.pointer")}
                          </a>
                        </dd>
                      ) : null}
                    </div>
                  ),
                )}
              </dl>
              {/* One "Notes" list, at most five one-line facts: what the
                  invoice cannot say on a row. "Notes on the invoice" and "What
                  the price covers" were two lists restating the table and
                  `/product` (B11). */}
              <div>
                <Eyebrow as="h2">{t("marketing.pricing.notes.title")}</Eyebrow>
                <MarginNotes
                  className="mt-4"
                  notes={[
                    t("marketing.pricing.notes.note1"),
                    t("marketing.pricing.notes.note2"),
                    ...earlyAccessPrice.includedKeys.map((key) => t(key)),
                    // The upgrade address, not the support one: marketing.md
                    // routes "how do I move a trial shop to paid" through its
                    // own inbox, and this is its one public line.
                    t("marketing.pricing.trialNote", { email: ONBOARDING_EMAIL }),
                  ]}
                />
                <Link
                  href="/product"
                  className={buttonClass({ variant: "link", flush: true, className: "mt-4" })}
                >
                  {t("marketing.pricing.seeFullList")}
                </Link>
              </div>
            </div>

            <FunnelCtas locale={locale} source="pricing" footnotes={{ offer }} className="mt-12" />
          </div>
        </section>

        {/* The flat price is only meaningful next to the model it replaces.
            Quiet rows: the incumbents' terms are evidence, and our answer is
            the one line that gets full ink. The "both rows are the channels'
            own terms" disclaimer is said once, under the rows (B11). */}
        <section className="border-b border-border">
          <div className={`${CONTAINER} py-16 lg:py-24`}>
            <div className="max-w-3xl">
              <h2 className={`${BANNER_TITLE_CLASS} sm:text-4xl`}>
                {t("marketing.pricing.feeAnchor.title")}
              </h2>
              <ul className="mt-10 space-y-8">
                {channelFees.map(({ guide, claim }) => (
                  <li key={guide.slug}>
                    <h3 className="font-semibold leading-6">{guide.competitor}</h3>
                    <p className="mt-1 leading-7 text-muted">{claim}</p>
                    <Link
                      href={`/switching/${guide.slug}`}
                      className={buttonClass({
                        variant: "link",
                        flush: true,
                        className: "mt-1 text-start",
                      })}
                    >
                      {t("marketing.pricing.feeAnchor.guideLink", { competitor: guide.competitor })}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-sm leading-6 text-muted">
                {t("marketing.pricing.feeAnchor.sourcesNote")}
              </p>
              <p className="mt-10 border-l-2 border-primary pl-5 text-lg leading-8">
                {percentArm
                  ? t("marketing.pricing.percentArm.ours", params)
                  : t("marketing.pricing.feeAnchor.ours")}
              </p>
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
