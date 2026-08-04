import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { MarketingNav, MarketingNavFallback } from "@/components/MarketingNav";
import { FeatureGroupsGrid } from "@/components/MarketingSections";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE, type DiverLocale } from "@/i18n/settings";
import { trialHref } from "@/lib/funnel";
import { earlyAccessPrice, fullShopExport, sharedLinkCard } from "@/lib/marketing";
import { getMigrationGuide, MIGRATION_GUIDES } from "@/lib/migration-guides";
import { FOUNDER_EMAIL } from "@/lib/platform-mail";

// `instant = true`: navigating here paints immediately. Every request-scoped
// read sits behind a `<Suspense>` boundary — this segment's `loading.tsx`, or
// one placed inside the page — so the frame lands without waiting on the
// request. `next build` audits the claim. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Pricing — one flat price per shop | DiveDay",
  description:
    "One flat price for the whole dive shop — bookings, waivers, cert checks, trip prep, and the boat manifest included. No setup fee, no per-seat math, no feature tiers.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    ...sharedLinkCard,
    title: "DiveDay pricing — one flat price per shop",
    description:
      "Every workflow DiveDay ships, in one plan. No setup fee, no per-seat math, no feature tiers.",
    url: "/pricing",
  },
  // `summary_large_image`: the OG block above names the shared link card
  // (`sharedLinkCard` → `src/app/opengraph-image.tsx`), so the large card has an
  // image to fill it — docs/product/marketing.md, Twitter-card policy. The
  // price figure deliberately stays out of the card: it lives in exactly one
  // place (`earlyAccessPrice`), and a card is a copy that goes stale silently.
  twitter: {
    card: "summary_large_image",
    title: "DiveDay pricing — one flat price per shop",
    description:
      "Every workflow DiveDay ships, in one plan. No setup fee, no per-seat math, no feature tiers.",
  },
};

export default function PricingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
      <Suspense fallback={<PricingBody locale={DEFAULT_DIVER_LOCALE} />}>
        <LocalizedPricingBody />
      </Suspense>
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </div>
  );
}

async function LocalizedPricingBody() {
  const locale = await requestLocale();
  return <PricingBody locale={locale} />;
}

/** Cached per negotiated locale (DIVER_LOCALES — two entries) — no session-scoped content. */
async function PricingBody({ locale }: { locale: DiverLocale }) {
  "use cache";
  cacheLife("max");
  const t = diverTranslator(locale);
  // Generated from the migration-guides registry, never hand-listed, so a new
  // guide can't be silently omitted from this answer.
  const competitors = new Intl.ListFormat(locale, { type: "conjunction" }).format(
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

  const faq = [
    {
      question: t("marketing.pricing.faq.whatIncluded.question"),
      answer: t("marketing.pricing.faq.whatIncluded.answer"),
    },
    {
      question: t("marketing.pricing.faq.billing.question"),
      answer: t("marketing.pricing.faq.billing.answer"),
    },
    {
      question: t("marketing.pricing.faq.trialMeaning.question"),
      answer: t("marketing.pricing.faq.trialMeaning.answer"),
    },
    {
      question: t("marketing.pricing.faq.seeBefore.question"),
      answer: t("marketing.pricing.faq.seeBefore.answer"),
    },
    {
      question: t("marketing.pricing.faq.offline.question"),
      answer: t("marketing.pricing.faq.offline.answer"),
    },
    {
      question: t("marketing.pricing.faq.dataIfNotWorking.question"),
      answer: t("marketing.pricing.faq.dataIfNotWorking.answer", {
        claim: t(fullShopExport.claimKey),
        terms: t(fullShopExport.termsKey),
      }),
    },
    {
      question: t("marketing.pricing.faq.switching.question"),
      answer: t("marketing.pricing.faq.switching.answer", { competitors }),
    },
    {
      question: t("marketing.pricing.faq.agency.question"),
      answer: t("marketing.pricing.faq.agency.answer"),
    },
    {
      question: t("marketing.pricing.faq.pos.question"),
      answer: t("marketing.pricing.faq.pos.answer"),
    },
    {
      question: t("marketing.pricing.faq.whyFounding.question"),
      answer: t("marketing.pricing.faq.whyFounding.answer"),
    },
    {
      question: t("marketing.pricing.faq.multipleLocations.question"),
      answer: t("marketing.pricing.faq.multipleLocations.answer"),
    },
  ] as const;

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
        <section className="border-b border-border">
          <div className="mx-auto max-w-4xl px-6 py-20 text-center lg:py-28">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              {t("marketing.pricing.eyebrow")}
            </p>
            <h1 className="mt-5 text-4xl font-semibold tracking-[-0.045em] text-balance sm:text-6xl">
              {t("marketing.pricing.heroTitle")}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-muted">
              {t("marketing.pricing.heroDescription")}
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 py-16 lg:py-24">
          <div className="mx-auto max-w-xl rounded-2xl border-2 border-primary bg-surface p-7 shadow-xl shadow-primary/10 sm:p-9">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                  {t(earlyAccessPrice.nameKey)}
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight">
                  {t("marketing.pricing.completeAccess")}
                </h2>
              </div>
              <span className="rounded-full border border-border bg-surface-sunken px-3 py-1 text-xs font-semibold text-muted">
                {t("marketing.pricing.earlyAccessBadge")}
              </span>
            </div>
            <div className="mt-7 flex items-end gap-2">
              <span className="text-5xl font-semibold tracking-[-0.05em]">
                {earlyAccessPrice.price}
              </span>
              <span className="pb-1 text-sm text-muted">{t(earlyAccessPrice.cadenceKey)}</span>
            </div>
            <p className="mt-4 leading-7 text-muted">{t(earlyAccessPrice.descriptionKey)}</p>
            <ul className="mt-7 space-y-3 text-sm leading-6 text-muted">
              {earlyAccessPrice.includedKeys.map((item) => (
                <li key={item} className="flex gap-3">
                  <span className="font-semibold text-primary">✓</span>
                  <span>{t(item)}</span>
                </li>
              ))}
            </ul>
            <Link
              href={trialHref("pricing")}
              className={buttonClass({
                size: "cta",
                className: "mt-8 w-full",
              })}
            >
              {t("marketing.common.startTrial")}
            </Link>
            <form action={enterDemoAction} className="mt-3">
              <FunnelTag source="pricing" />
              <SubmitButton
                pendingLabel={t("marketing.pricing.gettingDemoReady")}
                className={buttonClass({
                  variant: "secondary",
                  size: "cta",
                  className: "w-full cursor-pointer border-border-strong disabled:opacity-70",
                })}
              >
                {t("marketing.common.tryDemo")}
              </SubmitButton>
            </form>
          </div>
          <p className="mx-auto mt-5 max-w-xl text-center text-sm leading-6 text-muted">
            {t("marketing.pricing.feesNote")}
          </p>
        </section>

        {/* The flat price is only meaningful next to the model it replaces.
            Sits directly under the card so the two numbers are read together,
            and above the included list, which answers a different question. */}
        <section className="border-t border-border">
          <div className="mx-auto max-w-4xl px-6 py-16 lg:py-20">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              {t("marketing.pricing.feeAnchor.eyebrow")}
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
              {t("marketing.pricing.feeAnchor.title")}
            </h2>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
              {t("marketing.pricing.feeAnchor.body")}
            </p>
            <ul className="mt-8 space-y-4">
              {channelFees.map(({ guide, claim }) => (
                <li
                  key={guide.slug}
                  className="rounded-2xl border border-border bg-surface p-5 sm:p-6"
                >
                  <h3 className="font-semibold leading-6">{guide.competitor}</h3>
                  <p className="mt-2 leading-7 text-muted">{claim}</p>
                  <Link
                    href={`/switching/${guide.slug}`}
                    className={buttonClass({ variant: "link", className: "mt-2 px-0 text-left" })}
                  >
                    {t("marketing.pricing.feeAnchor.guideLink", { competitor: guide.competitor })}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-6 max-w-2xl leading-7 text-muted">
              {t("marketing.pricing.feeAnchor.ours")}
            </p>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
              {t("marketing.pricing.feeAnchor.sourcesNote")}
            </p>
          </div>
        </section>

        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-7xl px-6 py-16 lg:py-20">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                {t("marketing.pricing.includedEyebrow")}
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
                {t("marketing.pricing.includedTitle")}
              </h2>
            </div>
            {/* Summary treatment, not the full checklists: the product page
                already carries the complete inventory, and a landing → product
                → pricing walk was reading the same ~30 lines twice more
                (design review). Pricing answers "what does it cost"; the list
                lives one click away. */}
            <div className="mt-10">
              <FeatureGroupsGrid locale={locale} columns={2} featuresPerGroup={1} />
            </div>
            <Link href="/product" className={buttonClass({ variant: "link", className: "mt-6" })}>
              {t("marketing.pricing.seeFullList")}
            </Link>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-6 py-20 lg:py-24">
          <p className="text-center text-sm font-semibold tracking-widest text-primary uppercase">
            {t("marketing.pricing.faqEyebrow")}
          </p>
          <h2 className="mt-3 text-center text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
            {t("marketing.pricing.faqTitle")}
          </h2>
          <div className="mt-10 divide-y divide-border rounded-2xl border border-border bg-surface">
            {faq.map((item) => (
              <article key={item.question} className="p-6">
                <h3 className="text-lg font-semibold">{item.question}</h3>
                <p className="mt-2 leading-7 text-muted">{item.answer}</p>
              </article>
            ))}
          </div>
          <div className="mt-10 flex flex-col items-center gap-4 text-center">
            <p className="max-w-xl text-lg leading-8 text-muted">
              {t("marketing.pricing.stillQuestion")}
            </p>
            <a
              href={`mailto:${FOUNDER_EMAIL}`}
              className={buttonClass({ className: "cursor-pointer" })}
            >
              {t("marketing.pricing.emailCta", { email: FOUNDER_EMAIL })}
            </a>
          </div>
        </section>
      </main>
    </>
  );
}
