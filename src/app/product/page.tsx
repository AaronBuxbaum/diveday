import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { MarketingNav, MarketingNavFallback } from "@/components/MarketingNav";
import { FrontDeskReadinessFallback } from "@/components/MarketingScreenFallbacks";
import {
  CaptainPhoneFrame,
  FeatureGroupsGrid,
  MarketingMockup,
} from "@/components/MarketingSections";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE, type DiverLocale } from "@/i18n/settings";
import { trialHref } from "@/lib/funnel";
import { productCapabilityIndex } from "@/lib/marketing";

export const metadata: Metadata = {
  title: "Product — booking to head count | DiveDay",
  description:
    "How DiveDay runs a dive shop's day: bookings, waivers, cert checks, trip prep, and a boat manifest that keeps working when the signal doesn't.",
  alternates: { canonical: "/product" },
  openGraph: {
    title: "The DiveDay product — booking to head count",
    description:
      "Bookings, waivers, cert checks, trip prep, and the boat manifest, organized around the trip itself.",
    url: "/product",
  },
};

export default function ProductPage() {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
      <Suspense fallback={<ProductBody locale={DEFAULT_DIVER_LOCALE} />}>
        <LocalizedProductBody />
      </Suspense>
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </div>
  );
}

async function LocalizedProductBody() {
  const locale = await requestLocale();
  return <ProductBody locale={locale} />;
}

/** Cached per negotiated locale (DIVER_LOCALES — two entries) — no session-scoped content. */
async function ProductBody({ locale }: { locale: DiverLocale }) {
  "use cache";
  cacheLife("max");
  const t = diverTranslator(locale);

  const notCovered = [
    {
      title: t("marketing.product.notCovered.pos.title"),
      detail: t("marketing.product.notCovered.pos.detail"),
    },
    {
      title: t("marketing.product.notCovered.gearSerials.title"),
      detail: t("marketing.product.notCovered.gearSerials.detail"),
    },
    {
      title: t("marketing.product.notCovered.agencyLine.title"),
      detail: t("marketing.product.notCovered.agencyLine.detail"),
    },
  ] as const;

  return (
    <main className="flex-1">
      <section className="border-b border-border">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center lg:py-28">
          <p className="text-sm font-semibold tracking-widest text-primary uppercase">
            {t("marketing.product.eyebrow")}
          </p>
          <h1 className="mt-5 text-4xl font-semibold tracking-[-0.045em] text-balance sm:text-6xl">
            {t("marketing.product.heroTitle")}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-muted">
            {t("marketing.product.heroDescription")}
          </p>
          {/* The nav tap that lands here is the most evaluation-intent click
              on the site; without its own CTA the first offered action was
              the nav's trial link — the wrong ask while a buyer is still
              verifying claims. Same one-primary block as the home hero. */}
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <form action={enterDemoAction} className="w-full sm:w-auto">
              <FunnelTag source="product" />
              <SubmitButton
                pendingLabel={t("marketing.product.gettingDemoReady")}
                className={buttonClass({
                  size: "cta",
                  className: "w-full cursor-pointer disabled:opacity-70 sm:w-auto",
                })}
              >
                {t("marketing.common.tryDemo")}
              </SubmitButton>
            </form>
            <Link
              href={trialHref("product")}
              className={buttonClass({
                variant: "secondary",
                size: "cta",
                className: "w-full border-border-strong sm:w-auto",
              })}
            >
              {t("marketing.common.startTrial")}
            </Link>
          </div>
          <p className="mt-3 text-sm font-medium text-muted">{t("marketing.common.demoNote")}</p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 lg:py-28">
        <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              {t("marketing.product.readinessEyebrow")}
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
              {t("marketing.product.readinessTitle")}
            </h2>
            <p className="mt-5 text-lg leading-8 text-muted">
              {t("marketing.product.readinessDescription")}
            </p>
            <ul className="mt-7 space-y-3 text-sm leading-6 text-muted">
              <li className="flex gap-3">
                <span className="font-semibold text-primary">01</span>{" "}
                {t("marketing.product.readinessStep1")}
              </li>
              <li className="flex gap-3">
                <span className="font-semibold text-primary">02</span>{" "}
                {t("marketing.product.readinessStep2")}
              </li>
              <li className="flex gap-3">
                <span className="font-semibold text-primary">03</span>{" "}
                {t("marketing.product.readinessStep3")}
              </li>
            </ul>
          </div>
          <MarketingMockup
            label={t("marketing.product.readinessMockupLabel")}
            className="shadow-xl shadow-foreground/5"
          >
            <FrontDeskReadinessFallback locale={locale} />
          </MarketingMockup>
        </div>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:py-28">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              {t("marketing.product.systemEyebrow")}
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
              {t("marketing.product.systemTitle")}
            </h2>
          </div>
          <div className="mt-12">
            <FeatureGroupsGrid columns={2} />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 lg:py-28">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.8fr] lg:items-center">
          <div className="order-2 lg:order-1">
            <CaptainPhoneFrame
              label={t("marketing.product.captainPhoneLabel")}
              locale={locale}
              className="mx-auto max-w-sm"
            />
          </div>
          <div className="order-1 lg:order-2">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              {t("marketing.product.dockEyebrow")}
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
              {t("marketing.product.dockTitle")}
            </h2>
            <p className="mt-5 text-lg leading-8 text-muted">
              {t("marketing.product.dockDescription")}
            </p>
            <p className="mt-5 rounded-xl border border-border bg-surface-sunken p-4 text-sm leading-6 text-muted">
              {t("marketing.product.dockNote")}
            </p>
          </div>
        </div>
        {/* A door out mid-page: the dock story is the differentiator, and a
            convinced reader shouldn't have to scroll six more sections to act
            on it (conversion review — one CTA at the bottom of ten sections). */}
        <div className="mt-14 flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface px-6 py-8 text-center sm:flex-row sm:justify-between sm:text-left">
          <h3 className="text-xl font-semibold tracking-tight">
            {t("marketing.common.midCtaTitle")}
          </h3>
          <div className="flex flex-col gap-3 sm:flex-row">
            <form action={enterDemoAction}>
              <FunnelTag source="product" />
              <SubmitButton
                pendingLabel={t("marketing.product.gettingDemoReady")}
                className={buttonClass({ className: "cursor-pointer disabled:opacity-70" })}
              >
                {t("marketing.common.tryDemo")}
              </SubmitButton>
            </form>
            <Link
              href={trialHref("product")}
              className={buttonClass({ variant: "secondary", className: "border-border-strong" })}
            >
              {t("marketing.common.startTrial")}
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 lg:py-28">
        <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              {t("marketing.product.paymentEyebrow")}
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
              {t("marketing.product.paymentTitle")}
            </h2>
            <p className="mt-5 text-lg leading-8 text-muted">
              {t("marketing.product.paymentDescription")}
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-surface p-5 sm:p-6">
              <h3 className="font-semibold leading-6">{t("marketing.product.yourAccountTitle")}</h3>
              <p className="mt-3 text-sm leading-6 text-muted">
                {t("marketing.product.yourAccountBody")}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-5 sm:p-6">
              <h3 className="font-semibold leading-6">{t("marketing.product.pricedTitle")}</h3>
              <p className="mt-3 text-sm leading-6 text-muted">
                {t("marketing.product.pricedBody")}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-surface">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:py-28">
          <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
            <div>
              <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                {t("marketing.product.recapEyebrow")}
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
                {t("marketing.product.recapTitle")}
              </h2>
              <p className="mt-5 text-lg leading-8 text-muted">
                {t("marketing.product.recapDescription")}
              </p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-background p-5 sm:p-6">
                <p className="text-xs font-semibold tracking-widest text-primary uppercase">
                  {t("marketing.product.nightBeforeEyebrow")}
                </p>
                <h3 className="mt-3 font-semibold leading-6">
                  {t("marketing.product.nightBeforeTitle")}
                </h3>
                <p className="mt-3 text-sm leading-6 text-muted">
                  {t("marketing.product.nightBeforeBody")}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-background p-5 sm:p-6">
                <p className="text-xs font-semibold tracking-widest text-primary uppercase">
                  {t("marketing.product.afterTripEyebrow")}
                </p>
                <h3 className="mt-3 font-semibold leading-6">
                  {t("marketing.product.afterTripTitle")}
                </h3>
                <p className="mt-3 text-sm leading-6 text-muted">
                  {t("marketing.product.afterTripBody")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:py-28">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              {t("marketing.product.boxEyebrow")}
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
              {t("marketing.product.boxTitle")}
            </h2>
            <p className="mt-4 text-lg leading-8 text-muted">
              {t("marketing.product.boxDescription")}
            </p>
          </div>
          <details className="mt-12 group">
            <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 text-sm font-semibold text-primary [&::-webkit-details-marker]:hidden">
              {t("marketing.product.fullListSummary")}
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-4 transition-transform group-open:rotate-180"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <div className="mt-8 grid gap-x-10 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
              {productCapabilityIndex.map((group) => (
                <section key={group.area}>
                  <h3 className="text-xs font-semibold tracking-widest text-primary uppercase">
                    {group.area}
                  </h3>
                  <ul className="mt-4 space-y-2.5 text-sm leading-6 text-muted">
                    {group.items.map((item) => (
                      <li key={item} className="flex gap-2.5">
                        <span aria-hidden="true" className="font-semibold text-primary">
                          ✓
                        </span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </details>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 lg:py-24">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold tracking-widest text-primary uppercase">
            {t("marketing.product.noEyebrow")}
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
            {t("marketing.product.noTitle")}
          </h2>
          <p className="mt-4 text-lg leading-8 text-muted">
            {t("marketing.product.noDescription")}
          </p>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {notCovered.map((item) => (
            <div key={item.title} className="rounded-xl border border-border bg-surface p-5 sm:p-6">
              <h3 className="font-semibold leading-6">{item.title}</h3>
              <p className="mt-3 text-sm leading-6 text-muted">{item.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-6 py-14 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {t("marketing.product.closingTitle")}
            </h2>
            <p className="mt-2 text-muted">{t("marketing.product.closingDescription")}</p>
            <Link
              href="/switching/spreadsheet"
              className={buttonClass({ variant: "link", className: "mt-3 text-left" })}
            >
              {t("marketing.product.spreadsheetLink")}
            </Link>
          </div>
          {/* `shrink-0` matters: without it the closing text squeezes both
              buttons into ~140px three-line blobs at tablet widths. */}
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
            <form action={enterDemoAction}>
              <FunnelTag source="product" />
              <SubmitButton
                pendingLabel={t("marketing.product.gettingDemoReady")}
                className={buttonClass({
                  size: "cta",
                  className: "cursor-pointer disabled:opacity-70",
                })}
              >
                {t("marketing.common.tryDemo")}
              </SubmitButton>
            </form>
            <Link
              href={trialHref("product")}
              className={buttonClass({
                variant: "secondary",
                size: "cta",
                className: "border-border-strong",
              })}
            >
              {t("marketing.common.startTrial")}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
