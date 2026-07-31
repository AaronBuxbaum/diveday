import type { Metadata } from "next";
import Link from "next/link";
import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
import { MarketingFooter } from "@/components/MarketingFooter";
import { MarketingNav } from "@/components/MarketingNav";
import { FeatureGroupsGrid } from "@/components/MarketingSections";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { trialHref } from "@/lib/funnel";
import { earlyAccessPrice, fullShopExport } from "@/lib/marketing";
import { MIGRATION_GUIDES } from "@/lib/migration-guides";
import { FOUNDER_EMAIL } from "@/lib/platform-mail";

export const metadata: Metadata = {
  title: "Pricing — one flat price per shop | DiveDay",
  description:
    "One flat price for the whole dive shop — bookings, waivers, cert checks, trip prep, and the boat manifest included. No setup fee, no per-seat math, no feature tiers.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "DiveDay pricing — one flat price per shop",
    description:
      "Every workflow DiveDay ships, in one plan. No setup fee, no per-seat math, no feature tiers.",
    url: "/pricing",
  },
};

export default async function PricingPage() {
  const locale = await requestLocale();
  const t = diverTranslator(locale);
  // Generated from the migration-guides registry, never hand-listed, so a new
  // guide can't be silently omitted from this answer.
  const competitors = new Intl.ListFormat(locale, { type: "conjunction" }).format(
    MIGRATION_GUIDES.map((guide) => guide.competitor),
  );

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
        claim: fullShopExport.claim,
        terms: fullShopExport.terms,
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
    <div className="flex flex-1 flex-col">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD structured data built from our own constants above and `<`-escaped below.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <MarketingNav />
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
                  {earlyAccessPrice.name}
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
              <span className="pb-1 text-sm text-muted">{earlyAccessPrice.cadence}</span>
            </div>
            <p className="mt-4 leading-7 text-muted">{earlyAccessPrice.description}</p>
            <ul className="mt-7 space-y-3 text-sm leading-6 text-muted">
              {earlyAccessPrice.included.map((item) => (
                <li key={item} className="flex gap-3">
                  <span className="font-semibold text-primary">✓</span>
                  <span>{item}</span>
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
                {t("marketing.pricing.tryDemoFirst")}
              </SubmitButton>
            </form>
          </div>
          <p className="mx-auto mt-5 max-w-xl text-center text-sm leading-6 text-muted">
            {t("marketing.pricing.feesNote")}
          </p>
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
            <div className="mt-10">
              <FeatureGroupsGrid columns={2} />
            </div>
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
      <MarketingFooter />
    </div>
  );
}
