import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { DiverDoor } from "@/app/_components/DiverDoor";
import { Eyebrow } from "@/app/_components/Eyebrow";
import { ClosingCta, FunnelCtas } from "@/app/_components/FunnelCtas";
import { HomeBodySkeleton } from "@/app/_components/HomeBodySkeleton";
import { HomeHeroPhone } from "@/app/_components/HomeHeroPhone";
import { HomeWhyBand } from "@/app/_components/HomeWhyBand";
import { homeSoftwareJsonLd } from "@/app/_components/home-json-ld";
import { JsonLd } from "@/components/JsonLd";
import { ArrivalDeskFallback, WaiverSigningFallback } from "@/components/MarketingFeatureScreens";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { MarketingIllustration } from "@/components/MarketingIllustration";
import { MarketingReveal } from "@/components/MarketingReveal";
import {
  DiverBookingFallback,
  FrontDeskReadinessFallback,
  RecapPageFallback,
} from "@/components/MarketingScreenFallbacks";
import { MarginNotes, MarketingMockup } from "@/components/MarketingSections";
import { buttonClass } from "@/components/ui/button";
import { BANNER_TITLE_CLASS, LEAD_TITLE_CLASS } from "@/components/ui/typography";
import { requestPricingOffer } from "@/features/pricing-offer";
import { type DiverMessageKey, diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import type { DiverLocale } from "@/i18n/settings";
import { type FeaturePageSlug, featurePagePath, getFeaturePage } from "@/lib/feature-pages";
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
    "Online booking, waivers and medical forms, certification checks, check-in and a boat manifest that works with no signal, in one app for dive shops. Every screen runs in a live demo with no sign-up.",
  alternates: { canonical: "/" },
  openGraph: {
    ...sharedLinkCard,
    title: "DiveDay — dive shop software, from booking to roll call",
    description:
      "Online booking, waivers, certification checks, check-in and the boat manifest, in one app for dive shops.",
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
      "Online booking, waivers, certification checks, check-in and the boat manifest, in one app for dive shops.",
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
 * The one kicker for a *part of a section*: a short marker with a hairline rule
 * running out to the edge of its column. The booking's steps use it for when
 * each one happens, the portability diptych for which direction a record is
 * travelling. One atom, several compositions around it — inventing a new
 * treatment per band is what made the old page read as six renders of one
 * template.
 *
 * It is deliberately *not* the page's only small-caps-ish label: the hero's
 * category line and the directory's phase labels are uppercase, and they stay
 * that way because they name a whole thing (the product category, a part of a
 * shop's year) rather than locate a part within a section.
 *
 * Page-local until a second marketing page wants the same marker — at which
 * point it belongs in `src/components/MarketingSections.tsx` with the other
 * shared visual atoms, not copied.
 *
 * `as="h3"` where the marker is the *only* label its column has (the diptych),
 * so the section's two halves are named in the document outline; the step
 * rows leave it a `<p>`, because the `<h3>` they already carry is their name
 * and a marker heading above it would be a second, emptier one.
 */
function SectionMarker({ children, as: Tag = "p" }: { children: ReactNode; as?: "p" | "h3" }) {
  return (
    <div className="flex items-center gap-4">
      <Eyebrow as={Tag}>{children}</Eyebrow>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * One booking, followed from the shop's website to the boat and home again
 * (H-20261005-public-pages-sell, the 2026-10-05 rework). Each step is the screen that does it, two of
 * the builder's notes beside it, and a link to the feature page that tells the
 * rest. The order is the order a diver meets the shop in, which is also the
 * order an owner's doubts arrive in: will they book, does the paperwork come
 * back, who catches the diver who isn't cleared, does the roll call on the
 * boat hold, and what does the diver take home.
 *
 * Five steps, not the six the rework first drew: check-in at the counter was
 * cut in review, because its screen read as the readiness step's twin and its
 * one claim was the band's only one any rival makes. The directory below still
 * links its page.
 *
 * A step ends in its feature page rather than in a door into the demo, as the
 * rows here did until 2026-10-05: the feature page's own door opens the demo
 * on that very screen, as the role that uses it, which a door here could only
 * do by repeating it. The page keeps its two demo doors, hero and close.
 *
 * A step that draws a feature page's own screen reads that page's notes and
 * label by key (the release on the diver's phone), and the readiness step
 * quotes the certifications page's line about its rows, so the homepage and a
 * feature page can never describe one drawing two ways. The rest keep the
 * drawings and notes this page carries under `marketing.home.steps`.
 *
 * `id` is the bundle namespace under `marketing.home.steps`, never a rendered
 * string.
 */
const STEPS: readonly {
  id: "book" | "sign" | "check" | "aboard" | "recap";
  feature: FeaturePageSlug;
  notes: readonly [DiverMessageKey, DiverMessageKey];
  label: DiverMessageKey;
  screen: (locale: DiverLocale) => ReactNode;
}[] = [
  {
    id: "book",
    feature: "online-booking",
    notes: ["marketing.home.steps.book.note1", "marketing.home.steps.book.note2"],
    label: "marketing.home.steps.book.mockupLabel",
    screen: (locale) => <DiverBookingFallback locale={locale} />,
  },
  {
    id: "sign",
    feature: "waivers",
    notes: ["marketing.featurePages.waivers.note1", "marketing.featurePages.waivers.note3"],
    label: "marketing.featurePages.waivers.screenLabel",
    screen: (locale) => <WaiverSigningFallback locale={locale} />,
  },
  {
    id: "check",
    feature: "certifications",
    notes: ["marketing.featurePages.certifications.note3", "marketing.home.steps.check.note2"],
    label: "marketing.home.steps.check.mockupLabel",
    screen: (locale) => <FrontDeskReadinessFallback locale={locale} />,
  },
  {
    // The hero draws the roll-call phone, so this step draws the check-in
    // page's dock screen, by key (B14, 2026-10-25); the notes keep H-20260802-may-public-pages-say's
    // no-signal claim.
    id: "aboard",
    feature: "boat-manifest",
    notes: ["marketing.home.steps.aboard.note1", "marketing.home.steps.aboard.note2"],
    label: "marketing.featurePages.checkIn.screenLabel",
    screen: (locale) => <ArrivalDeskFallback locale={locale} />,
  },
  {
    // The recap goes out by itself a few hours after the boat is due back,
    // which is why it is the messages page this step opens.
    id: "recap",
    feature: "messages",
    notes: ["marketing.home.steps.recap.note1", "marketing.home.steps.recap.note2"],
    label: "marketing.home.steps.recap.mockupLabel",
    screen: (locale) => <RecapPageFallback locale={locale} />,
  },
];

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
            <Eyebrow>{t("marketing.home.eyebrow")}</Eyebrow>
            <h1 className="mt-4 text-5xl font-semibold tracking-[-0.045em] text-balance sm:text-6xl lg:text-7xl">
              {t("marketing.home.heroTitle")}
            </h1>
            <p className="mt-4 max-w-xl text-lg leading-8 text-muted sm:text-xl">
              {t("marketing.home.heroDescription")}
            </p>
            {/* The demo note stands under this pair only; pricing lives on its own page. */}
            <FunnelCtas locale={locale} source="home-hero" hero footnotes={{}} className="mt-6" />
            <DiverDoor t={t} />
          </div>
          <HomeHeroPhone locale={locale} />
        </div>
      </section>

      {/* The booking's steps, in the order a diver meets the shop:
          alternating rows, each a marker, a title, two of the builder's notes
          and the feature page's name beside a large drawing (`STEPS`). */}
      <MarketingReveal>
        <section className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-28">
          <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
            <h2 className={`max-w-2xl ${BANNER_TITLE_CLASS} sm:text-4xl`}>
              {t("marketing.home.stepsTitle")}
            </h2>
            <MarketingIllustration scene="harbor" locale={locale} />
          </div>

          {/* 96px between steps at every width, against 20px inside one below
              `lg`, so a phone reads each step as one unit rather than a
              drawing floating between two (design review, 2026-10-05). */}
          <ol className="mt-12 space-y-16 lg:mt-16 lg:space-y-20">
            {STEPS.map((step, index) => {
              const page = getFeaturePage(step.feature);
              if (!page) return null;
              return (
                // One list item per step, so a screen reader hears the
                // booking as the sequence it is; the step's `<h3>` names it
                // in the outline.
                <li key={step.id} className="grid items-center gap-5 lg:grid-cols-11 lg:gap-14">
                  {/* **Below `lg` the copy column dissolves** (`contents`), so
                      its parts and the screen stack in reading order: what
                      happens, the screen that does it, the notes on that
                      screen, then where the rest of it is. The notes are the
                      caption under a screen (docs/design/brand.md), and on a
                      phone they used to come before the screen they caption,
                      with the link reading as the drawing's title. From `lg`
                      it is a column beside the screen again, every `order`
                      reset, and the alternation is the column's own. */}
                  <div
                    className={`contents lg:col-span-5 lg:flex lg:flex-col ${index % 2 === 1 ? "lg:order-last" : ""}`}
                  >
                    <div>
                      <SectionMarker>{t(`marketing.home.steps.${step.id}.when`)}</SectionMarker>
                      <h3 className={`mt-3 ${LEAD_TITLE_CLASS} text-balance sm:text-3xl`}>
                        {t(`marketing.home.steps.${step.id}.title`)}
                      </h3>
                    </div>
                    <MarginNotes
                      notes={step.notes.map((key) => t(key))}
                      className="order-2 max-w-lg lg:order-none lg:mt-5"
                    />
                    {/* The page's own name is the link's words: the reader
                        has just read what the step does, and the name says
                        where the rest of it is. Its arrow is the "→" glyph
                        every other link on the page carries, not an icon.
                        `self-start` keeps the link its own width in the `lg`
                        flex column, `justify-self-start` in the phone's grid. */}
                    <Link
                      href={featurePagePath(page.slug)}
                      className={buttonClass({
                        variant: "link",
                        flush: true,
                        className:
                          "order-3 self-start justify-self-start text-start lg:order-none lg:mt-4",
                      })}
                    >
                      {t("marketing.home.stepLink", {
                        name: t(`marketing.featurePages.${page.key}.name`),
                      })}
                    </Link>
                  </div>
                  <div className="order-1 lg:order-none lg:col-span-6">
                    <MarketingMockup label={t(step.label)}>{step.screen(locale)}</MarketingMockup>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </MarketingReveal>

      {/* The product directory holds the full feature list. */}
      <div className="mx-auto w-full max-w-7xl px-6 pb-12">
        <Link href="/product#full-list" className={buttonClass({ variant: "link", flush: true })}>
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
              className={buttonClass({ variant: "link", flush: true, className: "text-start" })}
            >
              {t("marketing.home.guidesLink")}
            </Link>
            <Link
              href={switchingHref("/switching/spreadsheet", "home-records-arriving", "columns")}
              className={buttonClass({ variant: "link", flush: true, className: "text-start" })}
            >
              {t("marketing.home.spreadsheetLink")}
            </Link>
            <Link
              href="/pricing#export"
              className={buttonClass({ variant: "link", flush: true, className: "text-start" })}
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
