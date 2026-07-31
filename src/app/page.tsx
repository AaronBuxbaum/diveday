import type { Metadata } from "next";
import Link from "next/link";
import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
import { HomeCTA } from "@/components/HomeCTA";
import { MarketingFooter } from "@/components/MarketingFooter";
import { MarketingNav } from "@/components/MarketingNav";
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
import { scheduleAttributionHref, trialHref } from "@/lib/funnel";
import { earlyAccessPriceAmount, fullShopExport } from "@/lib/marketing";
import { MIGRATION_GUIDES } from "@/lib/migration-guides";

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

export default async function Home() {
  const locale = await requestLocale();
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
      mockupLabel: t("marketing.home.moments.diver.mockupLabel"),
      mockup: marketingMockups.diverBooking,
    },
    {
      role: t("marketing.home.moments.frontDesk.role"),
      title: t("marketing.home.moments.frontDesk.title"),
      description: t("marketing.home.moments.frontDesk.description"),
      mockupLabel: t("marketing.home.moments.frontDesk.mockupLabel"),
      mockup: marketingMockups.frontDeskReadiness,
    },
  ] as const;

  return (
    <div className="flex flex-1 flex-col">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD structured data built from our own constants above and `<`-escaped below.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(softwareApplicationJsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <MarketingNav />
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
              <div className="mt-8">
                <HomeCTA
                  enterDemoAction={enterDemoAction}
                  scheduleHref={scheduleAttributionHref(DEMO_SHOP_SLUG, "home-hero")}
                  copy={{
                    gettingReady: t("nav.gettingReady"),
                    tryDemo: t("nav.tryDemo"),
                    startTrial: t("nav.startTrial"),
                    seeLiveSchedule: t("nav.seeLiveSchedule"),
                  }}
                />
              </div>
              <p className="mt-4 text-sm text-muted">{t("marketing.home.exploreNote")}</p>
            </div>

            <div className="mx-auto w-full max-w-sm lg:max-w-md">
              <CaptainPhoneFrame label={t("marketing.home.phoneFrameLabel")} />
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
              >
                <MarketingMockup label={moment.mockupLabel}>
                  {moment.mockup.render()}
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
                {t("marketing.home.exportDescription1", {
                  claim: fullShopExport.claim,
                  terms: fullShopExport.terms,
                })}
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
                    {t("marketing.home.tryDemo")}
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
              <Link href="/pricing" className={buttonClass({ variant: "link" })}>
                {t("marketing.home.viewPricing")}
              </Link>
            </div>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
