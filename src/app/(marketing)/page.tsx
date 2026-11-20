import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { DiverDoor } from "@/app/_components/DiverDoor";
import { ClosingCta, FunnelCtas } from "@/app/_components/FunnelCtas";
import { HomeBodySkeleton } from "@/app/_components/HomeBodySkeleton";
import { HomeHeroChat } from "@/app/_components/HomeHeroChat";
import { HomeWalkthrough, type WalkBeat } from "@/app/_components/HomeWalkthrough";
import { HomeWalkthroughDoors } from "@/app/_components/HomeWalkthroughDoors";
import { HomeWhyBand } from "@/app/_components/HomeWhyBand";
import { homeSoftwareJsonLd } from "@/app/_components/home-json-ld";
import { STEPS, WALK_CLASSES } from "@/app/_components/home-steps";
import { JsonLd } from "@/components/JsonLd";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { MarketingReveal } from "@/components/MarketingReveal";
import { MarketingMockup } from "@/components/MarketingSections";
import { buttonClass } from "@/components/ui/button";
import { BANNER_TITLE_CLASS, LEAD_TITLE_CLASS } from "@/components/ui/typography";
import { requestPricingOffer } from "@/features/pricing-offer";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import type { DiverLocale } from "@/i18n/settings";
import { featurePagePath, getFeaturePage } from "@/lib/feature-pages";
import { switchingHref } from "@/lib/funnel";
import { midSeasonCutover, sharedLinkCard } from "@/lib/marketing";

// `instant = true`: navigating here paints immediately. Every request-scoped
// read sits behind a `<Suspense>` boundary placed inside the page — the root
// segment is the one place a `loading.tsx` is not an option, because
// `src/app/loading.tsx` wraps *every* route below it (`/switching/**`,
// `/sign-in`, `/about`, `/offline-manifest` all lack a boundary of their own
// and would inherit this page's skeleton). ADR 20260804-instant-navigation
// names the in-page boundary as the sanctioned alternative; `next build`
// audits the claim either way.
export const instant = true;

export const metadata: Metadata = {
  title: "Dive shop software, from booking to roll call — DiveDay",
  description:
    "Online booking, waivers, medical forms, certification checks, check-in, and a boat manifest that works with no signal, in one app for dive shops. Every screen runs in a live demo with no sign-up.",
  alternates: { canonical: "/" },
  openGraph: {
    ...sharedLinkCard,
    title: "DiveDay — dive shop software, from booking to roll call",
    description:
      "Online booking, waivers, certification checks, check-in, and the boat manifest, in one app for dive shops.",
    url: "/",
  },
  // `summary_large_image`: the shared link card resolves here, and this page
  // now names it like every other marketing page. It used to be the one that
  // did not, because the card was `src/app/opengraph-image.tsx` in this same
  // root segment and Next re-attached it for free; issue #1709 moved the card
  // to its own route handler to keep `next/og` out of every page entry, so
  // there is nothing left to inherit (docs/product/marketing.md, Twitter-card
  // policy).
  twitter: {
    card: "summary_large_image",
    title: "DiveDay — dive shop software, from booking to roll call",
    description:
      "Online booking, waivers, certification checks, check-in, and the boat manifest, in one app for dive shops.",
  },
};

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      {/* The body renders **once**, in the reader's own language, behind a
          skeleton — never twice, with an English copy of itself standing in
          for the localized one. That older arrangement bought the instant
          paint by rendering the whole page as its own fallback, and the swap
          that followed tore down and rebuilt the subtree, discarding whatever
          the visitor had already done to it: for an en-US reader the two
          renders were identical words, so it was invisible in every
          screenshot and assertion, and for an `es-ES` reader a link tapped
          before the Spanish body landed left them somewhere else on the page
          (FU-20260812-marketing-suspense-swap-discards-interaction, and
          `ProductPage` for the fuller note). A skeleton has nothing to tap, so
          there is nothing to lose — keep it that way. */}
      <Suspense fallback={<HomeBodySkeleton />}>
        <LocalizedHomeBody />
      </Suspense>
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </div>
  );
}

async function LocalizedHomeBody() {
  const [locale, offer] = await Promise.all([requestLocale(), requestPricingOffer()]);
  return (
    <>
      {/* For the configured offer, so it streams with the body (`homeSoftwareJsonLd`). */}
      <JsonLd data={homeSoftwareJsonLd(offer)} />
      <HomeBody locale={locale} />
    </>
  );
}

/**
 * The whole home page body, cached per negotiated locale (DIVER_LOCALES —
 * two entries). Everything here is deterministic given `locale`:
 * message-bundle copy and the feature registry. Nothing
 * session-scoped lives in this tree — the CTA forms only reference
 * `enterDemoAction` (a Server Action reference, safe to pass through per
 * Next's `"use cache"` interleaving rules).
 *
 * The page's shape (redesigned 2026-08-13, its middle rewritten 2026-10-05 for
 * H-20261005-public-pages-sell): the hero says what DiveDay is and what a shop gets, the steps follow
 * one booking to the boat and home again, then the compact origin account
 * gives the roll call its context. Records setup leads into the demo invitation. Each
 * section has its own composition rather than six renders of the same
 * eyebrow/h2/lede/card-grid template. Two demo doors, hero and close, with the
 * demo's cost stated once at the first of them (docs/product/marketing.md).
 */
async function HomeBody({ locale }: { locale: DiverLocale }) {
  "use cache";
  cacheLife("max");
  const t = diverTranslator(locale);

  return (
    <main className="flex-1">
      <section className="relative overflow-hidden border-b border-border">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-6 py-8 lg:grid-cols-[1fr_0.9fr] lg:items-center lg:gap-12 lg:py-16">
          <div className="max-w-2xl">
            <h1 className="text-5xl font-semibold tracking-[-0.045em] text-balance sm:text-6xl lg:text-7xl">
              {t("marketing.home.heroTitle")}
            </h1>
            <p className="mt-4 max-w-xl text-lg leading-8 text-muted sm:text-xl">
              {t("marketing.home.heroDescription")}
            </p>
            {/* The demo note stands under this pair only; pricing lives on its own page. */}
            <FunnelCtas locale={locale} source="home-hero" hero footnotes={{}} className="mt-6" />
            <DiverDoor t={t} />
          </div>
          <HomeHeroChat locale={locale} />
        </div>
      </section>

      {/* The booking's steps, in the order a diver meets the shop:
          alternating rows, each a marker, a title, two or three of the builder's notes
          and the feature page's name beside a large drawing (`STEPS`). */}
      <MarketingReveal>
        <section className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-28">
          <div className="max-w-3xl">
            <h2 className={`${BANNER_TITLE_CLASS} sm:text-4xl`}>
              {t("marketing.home.stepsTitle")}
            </h2>
          </div>

          {/* 96px between steps at every width, against 20px inside one below
              `lg`, so a phone reads each step as one unit rather than a
              drawing floating between two (design review, 2026-10-05). */}
          <HomeWalkthrough
            beats={STEPS.map(
              (step): WalkBeat => ({
                step: step.id,
                frame: step.id,
                caption: t(`marketing.home.steps.${step.id}.title`),
                lead: step.lead,
                hold: step.hold,
                tapMs: step.tapMs,
              }),
            )}
            labels={{
              label: t("marketing.home.walk.label"),
              position: t("marketing.home.walk.position", { n: "{n}", total: "{total}" }),
              pause: t("marketing.home.walk.pause"),
              play: t("marketing.home.walk.play"),
              previous: t("marketing.home.walk.previous"),
              next: t("marketing.home.walk.next"),
              goTo: t("marketing.home.walk.goTo", { n: "{n}" }),
              hint: t("marketing.home.walk.hint"),
            }}
          >
            <ol data-walk-list className={`mt-6 space-y-16 lg:mt-8 lg:space-y-20 ${WALK_CLASSES}`}>
              {STEPS.map((step) => {
                const page = step.feature ? getFeaturePage(step.feature) : undefined;
                return (
                  // One list item per step, so a screen reader hears the
                  // booking as the sequence it is; the step's `<h3>` names it
                  // in the outline.
                  <li
                    key={step.id}
                    data-walk-step={step.id}
                    data-walk-listed={step.listed ? "" : undefined}
                    className="grid items-start gap-5 lg:grid-cols-11 lg:gap-14"
                  >
                    {/* **Below `lg` the copy column dissolves** (`contents`), so
                      its parts and the screen stack in reading order: what
                      happens, the screen that does it, the notes on that
                      screen, then where the rest of it is. The notes are the
                      caption under a screen (docs/design/brand.md), and on a
                      phone they used to come before the screen they caption,
                      with the link reading as the drawing's title. From `lg`
                      it is a column beside the screen again, every `order`
                      reset, always on the same side so the story reads the same way
                      on every step. */}
                    <div className="contents lg:col-span-5 lg:flex lg:flex-col">
                      <h3 className={`${LEAD_TITLE_CLASS} text-balance sm:text-3xl`}>
                        {t(`marketing.home.steps.${step.id}.title`)}
                      </h3>
                      <p className="order-2 mt-3 max-w-lg text-lg leading-7 text-muted lg:order-none">
                        {t(step.note)}
                      </p>
                      {/* The page's own name is the link's words: the reader
                        has just read what the step does, and the name says
                        where the rest of it is. Its arrow is drawn by the link
                        style (`arrow`), not typed into the words.
                        `self-start` keeps the link its own width in the `lg`
                        flex column, `justify-self-start` in the phone's grid. */}
                      {page ? (
                        <Link
                          href={featurePagePath(page.slug)}
                          className={buttonClass({
                            variant: "link",
                            arrow: true,
                            flush: true,
                            className:
                              "order-3 self-start justify-self-start text-start lg:order-none lg:mt-4",
                          })}
                        >
                          {t("marketing.home.stepLink", {
                            name: t(`marketing.featurePages.${page.key}.name`),
                          })}
                        </Link>
                      ) : null}
                    </div>
                    <div className="order-1 lg:order-none lg:col-span-6">
                      <div data-walk-frame={step.id} data-walk-primary="">
                        <MarketingMockup label={t(step.label)}>
                          {/* Each screen fills the cell the taller one sets, so
                              a short booking card under a tall storefront sits
                              on the screen's own ground rather than above 350px
                              of blank frame (phone polish, 2026-11-20). */}
                          <div className="grid">
                            <div
                              data-walk-before
                              className="col-start-1 row-start-1 flex flex-col [&>*]:flex-1"
                            >
                              {step.before(locale)}
                            </div>
                            <div
                              data-walk-after
                              className="col-start-1 row-start-1 flex flex-col [&>*]:flex-1"
                            >
                              {step.screen(locale)}
                            </div>
                          </div>
                        </MarketingMockup>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </HomeWalkthrough>
          <HomeWalkthroughDoors locale={locale} />
        </section>
      </MarketingReveal>

      {/* The product directory holds the full feature list. */}
      <div className="mx-auto w-full max-w-7xl px-6 pb-12">
        <Link
          href="/product#full-list"
          className={buttonClass({ variant: "link", arrow: true, flush: true })}
        >
          {t("marketing.home.featuresLink")}
        </Link>
      </div>

      {/* The practical journey comes first; the short origin account keeps its
          own quiet band and the full story remains on About. */}
      <HomeWhyBand t={t} />

      {/* One arrival-led setup section. Export details remain a quiet link,
          without a second pitch or a repeated terms inventory. */}
      <MarketingReveal>
        <section className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-28">
          <h2 className={`max-w-3xl ${BANNER_TITLE_CLASS} sm:text-4xl`}>
            {t("marketing.home.exportTitle")}
          </h2>
          <div className="mt-6 max-w-2xl space-y-5 leading-7 text-muted">
            <p>{t("marketing.home.exportDescription1")}</p>
            {/* Retain the shared sample-review and handover qualifications. */}
            <p>{t(midSeasonCutover.claimKey)}</p>
          </div>
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
            <Link
              href={switchingHref("/switching", "home-records")}
              className={buttonClass({
                variant: "link",
                arrow: true,
                flush: true,
                className: "text-start",
              })}
            >
              {t("marketing.home.guidesLink")}
            </Link>
            <Link
              href={switchingHref("/switching/spreadsheet", "home-records-arriving", "columns")}
              className={buttonClass({
                variant: "link",
                arrow: true,
                flush: true,
                className: "text-start",
              })}
            >
              {t("marketing.home.spreadsheetLink")}
            </Link>
            <Link
              href="/pricing#export"
              className={buttonClass({
                variant: "link",
                arrow: true,
                flush: true,
                className: "text-start",
              })}
            >
              {t("marketing.common.recordsLink")}
            </Link>
          </div>
        </section>
      </MarketingReveal>

      {/* The one close (B15): what the shop gets, who reads a request, and
          the pair. Commercial details remain available through Pricing. */}
      <MarketingReveal>
        <ClosingCta locale={locale} source="home-closing" title={t("marketing.home.tryTitle")} />
      </MarketingReveal>
    </main>
  );
}
