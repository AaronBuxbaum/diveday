import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { DiverDoor } from "@/app/_components/DiverDoor";
import { Eyebrow } from "@/app/_components/Eyebrow";
import { ClosingCta, FunnelCtas } from "@/app/_components/FunnelCtas";
import { HomeBodySkeleton } from "@/app/_components/HomeBodySkeleton";
import { homeSoftwareJsonLd } from "@/app/_components/home-json-ld";
import { MarketingNav, MarketingNavFallback } from "@/app/_components/MarketingNav";
import { JsonLd } from "@/components/JsonLd";
import { ArrivalDeskFallback, WaiverSigningFallback } from "@/components/MarketingFeatureScreens";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { MarketingHeroMotion, MarketingReveal } from "@/components/MarketingReveal";
import {
  DiverBookingFallback,
  FrontDeskReadinessFallback,
  RecapPageFallback,
} from "@/components/MarketingScreenFallbacks";
import { CaptainPhoneFrame, MarginNotes, MarketingMockup } from "@/components/MarketingSections";
import { buttonClass } from "@/components/ui/button";
import { BANNER_TITLE_CLASS, LEAD_TITLE_CLASS } from "@/components/ui/typography";
import { type DiverMessageKey, diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import type { DiverLocale } from "@/i18n/settings";
import type { PlanTerms } from "@/lib/billing/pricing-plans";
import { type FeaturePageSlug, featurePagePath, getFeaturePage } from "@/lib/feature-pages";
import { switchingHref } from "@/lib/funnel";
import { cachedListFormat } from "@/lib/intl-cache";
import { fullShopExport, midSeasonCutover, sharedLinkCard } from "@/lib/marketing";
import { MIGRATION_GUIDES } from "@/lib/migration-guides";
import { requestPricingOffer } from "@/lib/pricing-arm-request";

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
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
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
      {/* Per pricing arm, so it streams with the body (`homeSoftwareJsonLd`). */}
      <JsonLd data={homeSoftwareJsonLd(offer)} />
      <HomeBody locale={locale} offer={offer} />
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
 * (H-93, the 2026-10-05 rework). Each step is the screen that does it, two of
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
    // page's dock screen, by key (B14, 2026-10-25); the notes keep H-94's
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
 * message-bundle copy and the migration-guide competitor list. Nothing
 * session-scoped lives in this tree — the CTA forms only reference
 * `enterDemoAction` (a Server Action reference, safe to pass through per
 * Next's `"use cache"` interleaving rules).
 *
 * The page's shape (redesigned 2026-08-13, its middle rewritten 2026-10-05 for
 * H-93): the hero says what DiveDay is and what a shop gets, the steps follow
 * one booking to the boat, the directory names every feature page, and the
 * records band and the close answer how a shop arrives, leaves and pays. Each
 * section has its own composition rather than six renders of the same
 * eyebrow/h2/lede/card-grid template. Two demo doors, hero and close, with the
 * demo's cost stated once at the first of them (docs/product/marketing.md).
 */
async function HomeBody({ locale, offer }: { locale: DiverLocale; offer: PlanTerms }) {
  "use cache";
  cacheLife("max");
  const t = diverTranslator(locale);
  // Generated from the migration-guides registry, never hand-listed, so a new
  // guide can't be silently omitted from the pitch that sends shops to it.
  const competitors = cachedListFormat(locale, { type: "disjunction" }).format(
    MIGRATION_GUIDES.map((guide) => guide.competitor),
  );

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
            {/* The terms stand under this pair and no later one (B09). */}
            <FunnelCtas
              locale={locale}
              source="home-hero"
              hero
              footnotes={{ offer }}
              className="mt-6"
            />
            <DiverDoor t={t} />
          </div>
          <MarketingHeroMotion>
            <div className="mx-auto w-full max-w-sm lg:max-w-md">
              <CaptainPhoneFrame label={t("marketing.home.phoneFrameLabel")} locale={locale} />
              <div className="relative z-10 mx-auto -mt-5 w-[88%] rounded-inset border border-border bg-surface px-4 py-3">
                <Eyebrow>{t("marketing.home.dockEyebrow")}</Eyebrow>
                <p className="mt-1 text-sm font-medium">{t("marketing.home.dockDetail")}</p>
              </div>
            </div>
          </MarketingHeroMotion>
        </div>
      </section>

      {/* The booking's steps, in the order a diver meets the shop:
          alternating rows, each a marker, a title, two of the builder's notes
          and the feature page's name beside a large drawing (`STEPS`). */}
      <MarketingReveal>
        <section className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-28">
          <div className="max-w-2xl">
            {/* One sentence and no lede: the rows beneath are the whole of
                what the band has to say. */}
            <h2 className={`${BANNER_TITLE_CLASS} sm:text-4xl`}>
              {t("marketing.home.stepsTitle")}
            </h2>
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

      {/* Every feature page, filed by when in a shop's year its job falls:
          the page's answer to "does it do X?", and the one place it links to
          all of them. The heading says they are all in the one plan, which
          is the price question a list of features raises. */}
      <div className="mx-auto w-full max-w-7xl px-6 pb-12">
        <Link href="/product#full-list" className={buttonClass({ variant: "link", flush: true })}>
          {t("marketing.home.featuresLink")}
        </Link>
      </div>

      {/* The portability band, and the one section whose geometry *is* its
          argument: records come in clean and leave the same way, so the two
          directions are a mirrored pair of equal columns under one statement —
          same marker, same rule, same weight — rather than the copy-left /
          visual-right split it shares with the hero and the steps.
          Arriving reads first (docs/product/marketing.md). */}
      <MarketingReveal>
        <section className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-28">
          <h2 className={`max-w-3xl ${BANNER_TITLE_CLASS} sm:text-4xl`}>
            {t("marketing.home.exportTitle")}
          </h2>

          <div className="mt-12 grid gap-12 lg:mt-16 lg:grid-cols-2 lg:gap-0">
            <div className="flex flex-col gap-5 lg:pr-14">
              <SectionMarker as="h3">{t("marketing.home.arrivingLabel")}</SectionMarker>
              <p className="leading-7 text-muted">{t("marketing.home.exportDescription1")}</p>
              {/* The mid-season objection, answered in the column where it is
                actually raised: a shop reading "bring your records in" in
                August is doing the arithmetic of a switch mid-season, and the
                four-phase move rail that answers it lives several thousand
                pixels away on a switching guide this reader may never open
                (docs/product/marketing-review-20260827.md). It renders the
                guides' own shared key rather than a homepage wording of the
                same promise — see `midSeasonCutover`. */}
              <p className="leading-7 text-muted">{t(midSeasonCutover.claimKey)}</p>
              {/* The import preview is drawn once on the site, on the switching
                  hub this band's closing link opens (B14). */}
              {/* The spreadsheet door belongs to this column, under the
                paragraph that asks for the sheet. `self-start` keeps the flex
                item its own width; `#columns` lands on the column table the
                link's words name, through `switchingHref` so the fragment
                follows the `?from=` tag. */}
              <Link
                href={switchingHref("/switching/spreadsheet", "home-records-arriving", "columns")}
                className={buttonClass({
                  variant: "link",
                  flush: true,
                  className: "self-start text-left",
                })}
              >
                {t("marketing.home.spreadsheetLink")}
              </Link>
            </div>

            <div className="flex flex-col gap-5 lg:border-l lg:border-border lg:pl-14">
              <SectionMarker as="h3">{t("marketing.home.leavingLabel")}</SectionMarker>
              <p className="leading-7 text-muted">
                {t("marketing.home.exportDescription2", {
                  claim: t(fullShopExport.claimKey),
                  terms: t(fullShopExport.termsKey),
                })}
              </p>
            </div>
          </div>

          {/* The full-width rule closes both portability columns before the
              switching hub link, keeping it distinct from the spreadsheet link. */}
          <div className="mt-12 border-t border-border pt-6">
            <Link
              href={switchingHref("/switching", "home-records")}
              className={buttonClass({ variant: "link", flush: true, className: "text-left" })}
            >
              {t("marketing.home.guidesLink", { competitors })}
            </Link>
          </div>
        </section>
      </MarketingReveal>

      {/* The one close (B15): what the shop gets, who reads a request, and
          the pair. The price is the hero's footnote, said once. */}
      <MarketingReveal>
        <ClosingCta locale={locale} source="home-closing" title={t("marketing.home.tryTitle")} />
      </MarketingReveal>
    </main>
  );
}
