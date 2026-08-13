import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { MarketingNav, MarketingNavFallback } from "@/components/MarketingNav";
import { ImportPreviewFallback } from "@/components/MarketingScreenFallbacks";
import {
  CaptainPhoneFrame,
  FeatureGroupsGrid,
  MarketingMockup,
  marketingMockups,
} from "@/components/MarketingSections";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE, type DiverLocale } from "@/i18n/settings";
import { scheduleAttributionHref, trialHref } from "@/lib/funnel";
import { cachedListFormat } from "@/lib/intl-cache";
import { earlyAccessPrice, earlyAccessPriceAmount, fullShopExport } from "@/lib/marketing";
import { MIGRATION_GUIDES } from "@/lib/migration-guides";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";
import { openGraphSite } from "@/lib/site-metadata";

// `instant = true`: navigating here paints immediately. Every request-scoped
// read sits behind a `<Suspense>` boundary — this segment's `loading.tsx`, or
// one placed inside the page — so the frame lands without waiting on the
// request. `next build` audits the claim. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Dive shop software for the whole dive day — DiveDay",
  description:
    "Bookings, waivers, cert checks, trip prep, and the boat manifest in one calm place. Easy to try in a live demo, safe to run the boat on, and your records come in clean and leave the same way.",
  alternates: { canonical: "/" },
  openGraph: {
    ...openGraphSite,
    title: "DiveDay — dive shop software for the whole dive day",
    description:
      "Bookings, waivers, cert checks, trip prep, and the boat manifest in one calm place — from first booking to final head count.",
    url: "/",
  },
  // `summary_large_image`: the shared link card is attached to this page by
  // file convention — `src/app/opengraph-image.tsx` sits in this same root
  // segment, which is why this is the one marketing page that does not spread
  // `sharedLinkCard` (docs/product/marketing.md, Twitter-card policy).
  twitter: {
    card: "summary_large_image",
    title: "DiveDay — dive shop software for the whole dive day",
    description:
      "Bookings, waivers, cert checks, trip prep, and the boat manifest in one calm place — from first booking to final head count.",
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
 * The page's one kicker: a short marker word with a hairline rule running out
 * to the edge of its column. The daily-moment rows use it for where in the day
 * they sit, the portability diptych for which direction a record is travelling.
 * One marker atom, several compositions around it — a new eyebrow style per
 * band is what made the old page read as six renders of one template.
 */
function SectionMarker({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <p className="text-sm font-semibold text-primary">{children}</p>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * The whole home page body, cached per negotiated locale (DIVER_LOCALES —
 * two entries). Everything here is deterministic given `locale`:
 * message-bundle copy and the migration-guide competitor list. Nothing
 * session-scoped lives in this tree — the CTA forms only reference
 * `enterDemoAction` (a Server Action reference, safe to pass through per
 * Next's `"use cache"` interleaving rules).
 *
 * The page's shape (redesigned 2026-08-13): one argument — the whole dive day
 * runs from one calm place — told once per section, each section in its own
 * composition rather than six renders of the same eyebrow/h2/lede/card-grid
 * template. Two demo doors, hero and close, with the demo's cost stated once
 * at the first of them; the old mid-page door and the two extra banded closes
 * merged into the single closing band (docs/product/marketing.md).
 */
async function HomeBody({ locale }: { locale: DiverLocale }) {
  "use cache";
  cacheLife("max");
  const t = diverTranslator(locale);
  // Generated from the migration-guides registry, never hand-listed, so a new
  // guide can't be silently omitted from the pitch that sends shops to it.
  const competitors = cachedListFormat(locale, { type: "disjunction" }).format(
    MIGRATION_GUIDES.map((guide) => guide.competitor),
  );
  // The day the hero's dock screen completes: a diver books days before, the
  // front desk clears the boat that morning. Alternating full-width rows —
  // the screen is the claim, so each row gives the mockup the wider column.
  const dailyMoments = [
    {
      when: t("marketing.home.moments.diver.when"),
      title: t("marketing.home.moments.diver.title"),
      description: t("marketing.home.moments.diver.description"),
      // The diver preview stays here rather than in the hero: there it
      // competed with the demo and trial CTAs for the first click; here it
      // sits beside the schedule mockup it opens.
      link: {
        label: t("marketing.home.moments.diver.link"),
        href: scheduleAttributionHref(DEMO_SHOP_SLUG, "home-diver-moment"),
      },
      mockupLabel: t("marketing.home.moments.diver.mockupLabel"),
      mockup: marketingMockups.diverBooking,
    },
    {
      when: t("marketing.home.moments.frontDesk.when"),
      title: t("marketing.home.moments.frontDesk.title"),
      description: t("marketing.home.moments.frontDesk.description"),
      link: null,
      mockupLabel: t("marketing.home.moments.frontDesk.mockupLabel"),
      mockup: marketingMockups.frontDeskReadiness,
    },
  ] as const;
  // What a shop gets back on the way out, listed rather than described — the
  // inventory is the reassurance, so it reads as a manifest, not a paragraph.
  const exportInventory = [
    t("marketing.home.exportItem1"),
    t("marketing.home.exportItem2"),
    t("marketing.home.exportItem3"),
    t("marketing.home.exportItem4"),
  ];

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
                  pendingLabel={t("marketing.common.gettingReady")}
                  className={buttonClass({
                    size: "cta",
                    className: "w-full cursor-pointer disabled:opacity-70 sm:w-auto",
                  })}
                >
                  {t("marketing.common.tryDemo")}
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
                {t("marketing.common.startTrial")}
              </Link>
            </div>
            {/* The demo's cost, stated once on the whole page — at the first
                door, where the decision is actually made. The closing band
                repeats the door, not the note. */}
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

      {/* The day, told backwards from the hero's dock screen: two alternating
          proof rows (marker → title → one sentence beside a large mockup)
          instead of the twin-card grid this section used to be — the pair are
          different moments of one day, and the geometry now says so. */}
      <section className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-28">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
            {t("marketing.home.momentsTitle")}
          </h2>
          <p className="mt-4 text-lg leading-8 text-pretty text-muted">
            {t("marketing.home.momentsDescription")}
          </p>
        </div>

        <div className="mt-14 space-y-16 lg:mt-20 lg:space-y-24">
          {dailyMoments.map((moment, index) => (
            <div key={moment.title} className="grid items-center gap-8 lg:grid-cols-11 lg:gap-14">
              <div className={`lg:col-span-5 ${index % 2 === 1 ? "lg:order-last" : ""}`}>
                <SectionMarker>{moment.when}</SectionMarker>
                <h3 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                  {moment.title}
                </h3>
                <p className="mt-3 max-w-lg leading-7 text-muted">{moment.description}</p>
                {moment.link ? (
                  <Link
                    href={moment.link.href}
                    className={buttonClass({ variant: "link", className: "mt-2 px-0" })}
                  >
                    {moment.link.label}
                  </Link>
                ) : null}
              </div>
              <div className="lg:col-span-6">
                <MarketingMockup
                  label={moment.mockupLabel}
                  className="shadow-xl shadow-foreground/5"
                >
                  {moment.mockup.render(locale)}
                </MarketingMockup>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* The breadth band: one provocative statement, the four groups as the
          answer, one door to the full story. Deliberately still four
          assertions rather than imagery — see docs/product/marketing.md. */}
      <section className="border-y border-border bg-surface">
        <div className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-24">
          <h2 className="mx-auto max-w-3xl text-center text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
            {t("marketing.home.productTitle")}
          </h2>
          <div className="mt-12">
            <FeatureGroupsGrid locale={locale} columns={4} featuresPerGroup={1} />
          </div>
          <div className="mt-10 text-center">
            <Link
              href="/product"
              className={buttonClass({
                variant: "secondary",
                className: "border-border-strong",
              })}
            >
              {t("marketing.home.seeFullProduct")}
            </Link>
          </div>
        </div>
      </section>

      {/* The portability band, and the one section whose geometry *is* its
          argument: records come in clean and leave the same way, so the two
          directions are a mirrored pair of equal columns under one statement —
          same marker, same rule, same weight — rather than the copy-left /
          visual-right split it shared with the hero and the first moment row.
          Arriving reads first (docs/product/marketing.md). */}
      <section className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-28">
        <h2 className="max-w-3xl text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
          {t("marketing.home.exportTitle")}
        </h2>

        <div className="mt-12 grid gap-12 lg:mt-16 lg:grid-cols-2 lg:gap-0">
          <div className="flex flex-col gap-5 lg:pr-14">
            <SectionMarker>{t("marketing.home.arrivingLabel")}</SectionMarker>
            <p className="leading-7 text-muted">{t("marketing.home.exportDescription1")}</p>
            <MarketingMockup
              label={t("marketing.home.importMockupLabel")}
              className="shadow-xl shadow-foreground/5"
            >
              <ImportPreviewFallback locale={locale} />
            </MarketingMockup>
          </div>

          <div className="flex flex-col gap-5 lg:border-l lg:border-border lg:pl-14">
            <SectionMarker>{t("marketing.home.leavingLabel")}</SectionMarker>
            <p className="leading-7 text-muted">
              {t("marketing.home.exportDescription2", { terms: t(fullShopExport.termsKey) })}
            </p>
            {/* A manifest, not a card: hairline rows echoing the marker rule
                above them. The bordered card this replaced put a second
                rounded box beside the import mockup and read as its twin,
                when the two halves are a picture and an inventory. */}
            <ul className="divide-y divide-border border-y border-border leading-6 text-muted">
              {exportInventory.map((item) => (
                <li key={item} className="flex gap-3 py-4">
                  <span aria-hidden="true" className="font-semibold text-primary">
                    ✓
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* One door to the whole switching surface — the hub fronts both the
            incumbent guides and the spreadsheet path, so two stacked link CTAs
            here were one door pretending to be two. */}
        <Link
          href="/switching"
          className={buttonClass({ variant: "link", className: "mt-10 px-0 text-left" })}
        >
          {t("marketing.home.guidesLink", { competitors })}
        </Link>
      </section>

      {/* The one close. Until 2026-08-13 the page ended on three consecutive
          banded CTAs (a mid-page demo card, a "Try it" band, a contact band);
          they merged into this single band — ask, price, and the human path,
          in that order. */}
      <section className="border-t border-border bg-surface">
        <div className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
              {t("marketing.home.tryTitle")}
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted">
              {t("marketing.home.tryDescription")}
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <form action={enterDemoAction}>
                <FunnelTag source="home-closing" />
                <SubmitButton
                  pendingLabel={t("marketing.common.gettingReady")}
                  className={buttonClass({
                    size: "cta",
                    className: "cursor-pointer disabled:opacity-70",
                  })}
                >
                  {t("marketing.common.tryDemo")}
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
                {t("marketing.common.startTrial")}
              </Link>
            </div>
            <p className="mt-6 font-medium">
              {t("marketing.home.priceLine", {
                price: earlyAccessPrice.price,
                cadence: t(earlyAccessPrice.cadenceKey),
              })}
            </p>
            <Link href="/pricing" className={buttonClass({ variant: "link" })}>
              {t("marketing.home.seeIncluded")}
            </Link>
          </div>

          <div className="mx-auto mt-16 flex max-w-3xl flex-col items-center gap-5 border-t border-border pt-10 text-center sm:flex-row sm:justify-between sm:gap-8 sm:text-left">
            <div>
              <h3 className="text-xl font-semibold tracking-tight">
                {t("marketing.home.contactTitle")}
              </h3>
              <p className="mt-2 leading-7 text-muted">{t("marketing.home.contactBody")}</p>
            </div>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className={buttonClass({
                variant: "secondary",
                className: "shrink-0 border-border-strong",
              })}
            >
              {t("marketing.home.contactCta", { email: SUPPORT_EMAIL })}
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
