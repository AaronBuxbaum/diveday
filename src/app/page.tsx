import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { MarketingNav, MarketingNavFallback } from "@/components/MarketingNav";
import {
  CaptainPhoneFrame,
  FeatureGroupsGrid,
  MarketingMockup,
  MarketingMomentCard,
  marketingMockups,
} from "@/components/MarketingSections";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE, type DiverLocale } from "@/i18n/settings";
import { scheduleAttributionHref, trialHref } from "@/lib/funnel";
import { earlyAccessPrice, earlyAccessPriceAmount, fullShopExport } from "@/lib/marketing";
import { MIGRATION_GUIDES } from "@/lib/migration-guides";
import { FOUNDER_EMAIL } from "@/lib/platform-mail";

export const metadata: Metadata = {
  title: "Dive shop software for the whole dive day — DiveDay",
  description:
    "Bookings, waivers, cert checks, trip prep, and the boat manifest in one calm place. Easy to try in a live demo, safe to run the boat on, and your data leaves with you any day.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "DiveDay — dive shop software for the whole dive day",
    description:
      "Bookings, waivers, cert checks, trip prep, and the boat manifest in one calm place — from first booking to final head count.",
    url: "/",
  },
};

const softwareApplicationJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "DiveDay",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "Dive shop software for bookings, waivers, cert checks, trip prep, and boat manifests.",
  offers: {
    "@type": "Offer",
    price: earlyAccessPriceAmount,
    priceCurrency: "USD",
  },
};

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD structured data built from our own constants above and `<`-escaped below.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(softwareApplicationJsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
      <Suspense fallback={<HomeBody locale={DEFAULT_DIVER_LOCALE} />}>
        <LocalizedHomeBody />
      </Suspense>
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </div>
  );
}

async function LocalizedHomeBody() {
  const locale = await requestLocale();
  return <HomeBody locale={locale} />;
}

/**
 * The whole home page body, cached per negotiated locale (DIVER_LOCALES —
 * two entries). Everything here is deterministic given `locale`:
 * message-bundle copy and the migration-guide competitor list. Nothing
 * session-scoped lives in this tree — the CTA forms only reference
 * `enterDemoAction` (a Server Action reference, safe to pass through per
 * Next's `"use cache"` interleaving rules).
 */
async function HomeBody({ locale }: { locale: DiverLocale }) {
  "use cache";
  cacheLife("max");
  const t = diverTranslator(locale);
  // Generated from the migration-guides registry, never hand-listed, so a new
  // guide can't be silently omitted from the pitch that sends shops to it.
  const competitors = new Intl.ListFormat(locale, { type: "disjunction" }).format(
    MIGRATION_GUIDES.map((guide) => guide.competitor),
  );
  const dailyMoments = [
    {
      role: t("marketing.home.moments.diver.role"),
      title: t("marketing.home.moments.diver.title"),
      description: t("marketing.home.moments.diver.description"),
      // The diver preview stays a moment-card link rather than a third hero
      // door: in the hero it competed with the demo and trial CTAs for the
      // first click; here it sits beside the schedule mockup it opens.
      link: {
        label: t("marketing.home.moments.diver.link"),
        href: scheduleAttributionHref(DEMO_SHOP_SLUG, "home-diver-moment"),
      },
      mockupLabel: t("marketing.home.moments.diver.mockupLabel"),
      mockup: marketingMockups.diverBooking,
    },
    {
      role: t("marketing.home.moments.frontDesk.role"),
      title: t("marketing.home.moments.frontDesk.title"),
      description: t("marketing.home.moments.frontDesk.description"),
      link: null,
      mockupLabel: t("marketing.home.moments.frontDesk.mockupLabel"),
      mockup: marketingMockups.frontDeskReadiness,
    },
  ] as const;

  return (
    <main className="flex-1">
      <section className="relative overflow-hidden border-b border-border">
        <div className="mx-auto grid w-full max-w-7xl gap-12 px-6 py-16 lg:grid-cols-[1fr_0.9fr] lg:items-center lg:py-24">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              {t("marketing.home.eyebrow")}
            </p>
            <h1 className="mt-5 text-5xl font-semibold tracking-[-0.045em] text-balance sm:text-6xl lg:text-7xl">
              {t("marketing.home.heroTitle")}
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-muted sm:text-xl">
              {t("marketing.home.heroDescription")}
            </p>
            {/* `w-full sm:w-auto` on all three: without it the primary (inside
                a form, hugging its label) rendered *narrower* than the
                stretched secondary link on phones — the demoted action was the
                biggest target on first paint. Full-width buttons are also the
                better wet-thumb target. */}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <form action={enterDemoAction} className="w-full sm:w-auto">
                <FunnelTag source="home-hero" />
                <SubmitButton
                  pendingLabel={t("nav.gettingReady")}
                  className={buttonClass({
                    size: "cta",
                    className: "w-full cursor-pointer disabled:opacity-70 sm:w-auto",
                  })}
                >
                  {t("nav.tryDemo")}
                </SubmitButton>
              </form>
              <Link
                href={trialHref("home-hero")}
                className={buttonClass({
                  variant: "secondary",
                  size: "cta",
                  className: "w-full border-border-strong sm:w-auto",
                })}
              >
                {t("nav.startTrial")}
              </Link>
            </div>
            <p className="mt-3 text-sm font-medium text-muted">{t("marketing.common.demoNote")}</p>
          </div>

          <div className="mx-auto w-full max-w-sm lg:max-w-md">
            <CaptainPhoneFrame label={t("marketing.home.phoneFrameLabel")} locale={locale} />
            <div className="mx-auto -mt-5 w-[88%] rounded-xl border border-border bg-surface px-4 py-3 shadow-lg">
              <p className="text-xs font-semibold tracking-widest text-primary uppercase">
                {t("marketing.home.dockEyebrow")}
              </p>
              <p className="mt-1 text-sm font-medium">{t("marketing.home.dockDetail")}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-28">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold tracking-widest text-primary uppercase">
            {t("marketing.home.momentsEyebrow")}
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
            {t("marketing.home.momentsTitle")}
          </h2>
          <p className="mt-4 text-lg leading-8 text-muted">
            {t("marketing.home.momentsDescription")}
          </p>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-2">
          {dailyMoments.map((moment) => (
            <MarketingMomentCard
              key={moment.role}
              role={moment.role}
              title={moment.title}
              description={moment.description}
              link={
                moment.link ? (
                  <Link
                    href={moment.link.href}
                    className={buttonClass({ variant: "link", className: "px-0" })}
                  >
                    {moment.link.label}
                  </Link>
                ) : undefined
              }
            >
              <MarketingMockup label={moment.mockupLabel}>
                {moment.mockup.render(locale)}
              </MarketingMockup>
            </MarketingMomentCard>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-24">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                {t("marketing.home.productEyebrow")}
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
                {t("marketing.home.productTitle")}
              </h2>
            </div>
            <Link
              href="/product"
              className={buttonClass({
                variant: "secondary",
                className: "self-start border-border-strong lg:self-auto",
              })}
            >
              {t("marketing.home.seeFullProduct")}
            </Link>
          </div>
          <div className="mt-12">
            <FeatureGroupsGrid columns={4} featuresPerGroup={1} />
          </div>
          {/* A door out at the page's midpoint: on a phone the hero CTA and
              the closing band sit several thousand pixels apart, and a reader
              convinced here shouldn't have to scroll to either end to act. */}
          <div className="mt-12 flex flex-col items-center gap-4 rounded-2xl border border-border bg-background px-6 py-8 text-center sm:flex-row sm:justify-between sm:text-left">
            <h3 className="text-xl font-semibold tracking-tight">
              {t("marketing.common.midCtaTitle")}
            </h3>
            <form action={enterDemoAction} className="shrink-0">
              <FunnelTag source="home-mid" />
              <SubmitButton
                pendingLabel={t("nav.gettingReady")}
                className={buttonClass({ className: "cursor-pointer disabled:opacity-70" })}
              >
                {t("nav.tryDemo")}
              </SubmitButton>
            </form>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-28">
        <div className="grid gap-10 lg:grid-cols-[1fr_0.9fr] lg:items-center">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              {t("marketing.home.exportEyebrow")}
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
              {t("marketing.home.exportTitle")}
            </h2>
            <p className="mt-5 text-lg leading-8 text-muted">
              {t("marketing.home.exportDescription1", { terms: fullShopExport.terms })}
            </p>
            <p className="mt-4 text-lg leading-8 text-muted">
              {t("marketing.home.exportDescription2")}
            </p>
            <Link
              href="/switching/spreadsheet"
              className={buttonClass({ variant: "link", className: "mt-4 text-left" })}
            >
              {t("marketing.home.spreadsheetLink")}
            </Link>
            <Link
              href="/switching"
              className={buttonClass({ variant: "link", className: "mt-2 text-left" })}
            >
              {t("marketing.home.switchingLink", { competitors })}
            </Link>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8">
            <p className="text-xs font-semibold tracking-widest text-primary uppercase">
              {t("marketing.home.inExportEyebrow")}
            </p>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-muted">
              <li className="flex gap-3">
                <span className="font-semibold text-primary">✓</span>
                <span>{t("marketing.home.exportItem1")}</span>
              </li>
              <li className="flex gap-3">
                <span className="font-semibold text-primary">✓</span>
                <span>{t("marketing.home.exportItem2")}</span>
              </li>
              <li className="flex gap-3">
                <span className="font-semibold text-primary">✓</span>
                <span>{t("marketing.home.exportItem3")}</span>
              </li>
              <li className="flex gap-3">
                <span className="font-semibold text-primary">✓</span>
                <span>{t("marketing.home.exportItem4")}</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-surface">
        <div className="mx-auto w-full max-w-7xl px-6 py-20 text-center lg:py-28">
          <p className="text-sm font-semibold tracking-widest text-primary uppercase">
            {t("marketing.home.tryEyebrow")}
          </p>
          <h2 className="mx-auto mt-4 max-w-3xl text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
            {t("marketing.home.tryTitle")}
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted">
            {t("marketing.home.tryDescription")}
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <div className="flex flex-col justify-center gap-3 sm:flex-row">
              <form action={enterDemoAction}>
                <FunnelTag source="home-closing" />
                <SubmitButton
                  pendingLabel={t("marketing.home.gettingReady")}
                  className={buttonClass({
                    size: "cta",
                    className: "cursor-pointer disabled:opacity-70",
                  })}
                >
                  {t("nav.tryDemo")}
                </SubmitButton>
              </form>
              <Link
                href={trialHref("home-closing")}
                className={buttonClass({
                  variant: "secondary",
                  size: "cta",
                  className: "border-border-strong",
                })}
              >
                {t("marketing.home.startTrial")}
              </Link>
            </div>
            <p className="text-sm text-muted">{t("marketing.common.demoNote")}</p>
            <p className="mt-2 font-medium">
              {t("marketing.home.priceLine", {
                price: earlyAccessPrice.price,
                cadence: earlyAccessPrice.cadence,
              })}
            </p>
            <Link href="/pricing" className={buttonClass({ variant: "link" })}>
              {t("marketing.home.seeIncluded")}
            </Link>
          </div>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-16 lg:flex-row lg:items-center lg:justify-between lg:py-20">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              {t("marketing.home.contactEyebrow")}
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-balance sm:text-3xl">
              {t("marketing.home.contactTitle")}
            </h2>
            <p className="mt-3 leading-7 text-muted">{t("marketing.home.contactBody")}</p>
          </div>
          <a
            href={`mailto:${FOUNDER_EMAIL}`}
            className={buttonClass({
              variant: "secondary",
              size: "cta",
              className: "shrink-0 self-start border-border-strong lg:self-auto",
            })}
          >
            {t("marketing.home.contactCta", { email: FOUNDER_EMAIL })}
          </a>
        </div>
      </section>
    </main>
  );
}
