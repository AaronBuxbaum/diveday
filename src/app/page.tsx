import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { FunnelCtas } from "@/app/_components/FunnelCtas";
import { MarketingNav, MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { MarketingHeroMotion, MarketingReveal } from "@/components/MarketingReveal";
import { ImportPreviewFallback } from "@/components/MarketingScreenFallbacks";
import {
  CaptainPhoneFrame,
  FeatureGroupsGrid,
  MarketingMockup,
  marketingMockups,
} from "@/components/MarketingSections";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass } from "@/components/ui/button";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import type { DiverLocale } from "@/i18n/settings";
import { scheduleAttributionHref, switchingHref } from "@/lib/funnel";
import { cachedListFormat } from "@/lib/intl-cache";
import { earlyAccessPrice, earlyAccessPriceAmount, fullShopExport } from "@/lib/marketing";
import { MIGRATION_GUIDES } from "@/lib/migration-guides";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";
import { openGraphSite } from "@/lib/site-metadata";

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
  const locale = await requestLocale();
  return <HomeBody locale={locale} />;
}

/**
 * What the static shell paints while {@link LocalizedHomeBody} resolves — this
 * page's equivalent of the `loading.tsx` that `/product` and `/pricing` now
 * carry, living inside the page because the root segment cannot have one (see
 * the `instant` note above).
 *
 * Shaped like the hero and the first daily-moment row so the streamed body
 * lands where the bars stood. Nothing in here is a link, a button, or a form:
 * that is the fix, not an economy.
 */
function HomeBodySkeleton() {
  return (
    <main className="flex-1 animate-pulse">
      <section className="border-b border-border">
        <div className="mx-auto grid w-full max-w-7xl gap-12 px-6 py-16 lg:grid-cols-[1fr_0.9fr] lg:items-center lg:py-24">
          <div className="max-w-2xl">
            <div className="h-4 w-40 rounded bg-surface-sunken" />
            <div className="mt-6 h-14 w-full rounded bg-surface-sunken sm:h-16" />
            <div className="mt-3 h-14 w-4/5 rounded bg-surface-sunken sm:h-16" />
            <div className="mt-7 h-5 w-full max-w-xl rounded bg-surface-sunken" />
            <div className="mt-2 h-5 w-2/3 max-w-lg rounded bg-surface-sunken" />
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <div className="h-12 w-full rounded-lg bg-surface-sunken sm:w-44" />
              <div className="h-12 w-full rounded-lg bg-surface-sunken sm:w-44" />
            </div>
            <div className="mt-4 h-4 w-72 max-w-full rounded bg-surface-sunken" />
          </div>
          {/* The captain's phone, and the card that overlaps its lower edge. */}
          <div className="mx-auto w-full max-w-sm lg:max-w-md">
            <div className="h-[30rem] rounded-[2.5rem] border border-border bg-surface" />
            <div className="mx-auto -mt-5 w-[88%] rounded-xl border border-border bg-surface px-4 py-3">
              <div className="h-3 w-24 rounded bg-surface-sunken" />
              <div className="mt-2 h-4 w-40 max-w-full rounded bg-surface-sunken" />
            </div>
          </div>
        </div>
      </section>

      {/* The day, told in alternating proof rows — one of them, at height. */}
      <section className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-28">
        <div className="max-w-2xl">
          <div className="h-9 w-full max-w-lg rounded bg-surface-sunken" />
          <div className="mt-5 h-5 w-full rounded bg-surface-sunken" />
          <div className="mt-2 h-5 w-3/4 rounded bg-surface-sunken" />
        </div>
        <div className="mt-14 grid items-center gap-8 lg:mt-20 lg:grid-cols-11 lg:gap-14">
          <div className="lg:col-span-5">
            <div className="flex items-center gap-4">
              <div className="h-4 w-28 rounded bg-surface-sunken" />
              <span aria-hidden="true" className="h-px flex-1 bg-border" />
            </div>
            <div className="mt-4 h-8 w-full max-w-sm rounded bg-surface-sunken" />
            <div className="mt-3 h-4 w-full max-w-md rounded bg-surface-sunken" />
            <div className="mt-2 h-4 w-2/3 max-w-sm rounded bg-surface-sunken" />
          </div>
          <div className="lg:col-span-6">
            <div className="h-80 rounded-2xl border border-border bg-surface" />
          </div>
        </div>
      </section>
    </main>
  );
}

/**
 * The one kicker for a *part of a section*: a short marker with a hairline rule
 * running out to the edge of its column. The daily-moment rows use it for where
 * in the day they sit, the portability diptych for which direction a record is
 * travelling. One atom, several compositions around it — inventing a new
 * treatment per band is what made the old page read as six renders of one
 * template.
 *
 * It is deliberately *not* the page's only small-caps-ish label: the hero's
 * category line and the breadth band's four card eyebrows are uppercase, and
 * they stay that way because they name a whole thing (the product category, a
 * capability group) rather than locate a part within a section.
 *
 * Page-local until a second marketing page wants the same marker — at which
 * point it belongs in `src/components/MarketingSections.tsx` with the other
 * shared visual atoms, not copied.
 *
 * `as="h3"` where the marker is the *only* label its column has (the diptych),
 * so the section's two halves are named in the document outline; the moment
 * rows leave it a `<p>`, because the `<h3>` they already carry is their name
 * and a marker heading above it would be a second, emptier one.
 */
function SectionMarker({ children, as: Tag = "p" }: { children: ReactNode; as?: "p" | "h3" }) {
  return (
    <div className="flex items-center gap-4">
      <Tag className="text-sm font-semibold text-primary">{children}</Tag>
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
  // `id` is the message-bundle namespace, never a rendered string: it is this
  // list's React key, and every other field here is localized copy. Keying on
  // the title would make a language switch look like two different components
  // to React (needless remount of the mockup beside it) and would collide the
  // moment a copy edit ever gave two rows the same heading.
  const dailyMoments = [
    {
      id: "diver",
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
      id: "frontDesk",
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
  // Keyed by message key, never by the rendered sentence: two locales edit
  // these independently, and a duplicated line would silently collide.
  const exportInventory = [
    "marketing.home.exportItem1",
    "marketing.home.exportItem2",
    "marketing.home.exportItem3",
    "marketing.home.exportItem4",
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
            <FunnelCtas locale={locale} source="home-hero" className="mt-8" />
            {/* The demo's cost, stated once on the whole page — at the first
                door, where the decision is actually made. The closing band
                repeats the door, not the note. */}
            <p className="mt-3 text-sm font-medium text-muted">{t("marketing.common.demoNote")}</p>
          </div>

          <MarketingHeroMotion>
            <div className="mx-auto w-full max-w-sm lg:max-w-md">
              <CaptainPhoneFrame label={t("marketing.home.phoneFrameLabel")} locale={locale} />
              <div className="mx-auto -mt-5 w-[88%] rounded-xl border border-border bg-surface px-4 py-3 shadow-lg">
                <p className="text-xs font-semibold tracking-widest text-primary uppercase">
                  {t("marketing.home.dockEyebrow")}
                </p>
                <p className="mt-1 text-sm font-medium">{t("marketing.home.dockDetail")}</p>
              </div>
            </div>
          </MarketingHeroMotion>
        </div>
      </section>

      {/* The day, told backwards from the hero's dock screen: two alternating
          proof rows (marker → title → one sentence beside a large mockup)
          instead of the twin-card grid this section used to be — the pair are
          different moments of one day, and the geometry now says so. */}
      <MarketingReveal>
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
              <div key={moment.id} className="grid items-center gap-8 lg:grid-cols-11 lg:gap-14">
                <div className={`lg:col-span-5 ${index % 2 === 1 ? "lg:order-last" : ""}`}>
                  <SectionMarker>{moment.when}</SectionMarker>
                  <h3 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                    {moment.title}
                  </h3>
                  <p className="mt-3 max-w-lg leading-7 text-muted">{moment.description}</p>
                  {moment.link ? (
                    <Link
                      href={moment.link.href}
                      className={buttonClass({ variant: "link", flush: true, className: "mt-2" })}
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
      </MarketingReveal>

      {/* The breadth band: one provocative statement, the four groups as the
          answer, one door to the full story. Deliberately still four
          assertions rather than imagery — see docs/product/marketing.md. */}
      <MarketingReveal>
        <section className="border-y border-border bg-surface">
          <div className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-24">
            <h2 className="mx-auto max-w-3xl text-center text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
              {t("marketing.home.productTitle")}
            </h2>
            <div className="mt-12">
              <FeatureGroupsGrid locale={locale} />
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
      </MarketingReveal>

      {/* The portability band, and the one section whose geometry *is* its
          argument: records come in clean and leave the same way, so the two
          directions are a mirrored pair of equal columns under one statement —
          same marker, same rule, same weight — rather than the copy-left /
          visual-right split it shared with the hero and the first moment row.
          Arriving reads first (docs/product/marketing.md). */}
      <MarketingReveal>
        <section className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-28">
          <h2 className="max-w-3xl text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
            {t("marketing.home.exportTitle")}
          </h2>

          <div className="mt-12 grid gap-12 lg:mt-16 lg:grid-cols-2 lg:gap-0">
            <div className="flex flex-col gap-5 lg:pr-14">
              <SectionMarker as="h3">{t("marketing.home.arrivingLabel")}</SectionMarker>
              <p className="leading-7 text-muted">{t("marketing.home.exportDescription1")}</p>
              <MarketingMockup
                label={t("marketing.home.importMockupLabel")}
                className="shadow-xl shadow-foreground/5"
              >
                <ImportPreviewFallback locale={locale} />
              </MarketingMockup>
              {/* The spreadsheet door, and it belongs to this column rather than
                to the section: the mockup above it is the importer reading a
                sheet, so the reader who recognizes their own sheet in it is
                already looking here. Deliberately *not* a second link stacked
                under the section copy beside the hub link — that shape came out
                on 2026-08-13 and is not what this restores
                (docs/product/marketing.md). Its copy is a label on the mockup
                ("Your spreadsheet, column by column"), not a fourth sentence of
                body copy: the paragraph above has already asked this reader for
                their sheet, so re-asking "Running the day on a spreadsheet?"
                here would qualify an audience the copy just addressed — and
                would rhyme, question-then-arrow, with the band's closing link.

                `self-start`, which the closing link needs no equivalent of:
                this one is a flex *item* in the column, so without it the item
                stretches to the full column width and `buttonClass`'s
                `justify-center` centers the label under a left-aligned
                paragraph.

                `#columns` lands the reader on the column table this link's own
                words name, rather than on the guide's hero three blocks above
                it — the wedge there is a good argument about what a spreadsheet
                cannot do, but it is not what was promised, and the gap reads as
                bait. The fragment goes through `switchingHref` so it can only
                land after the `?from=` tag. */}
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
                {t("marketing.home.exportDescription2", { terms: t(fullShopExport.termsKey) })}
              </p>
              {/* A manifest, not a card: hairline rows echoing the marker rule
                above them. The bordered card this replaced put a second
                rounded box beside the import mockup and read as its twin,
                when the two halves are a picture and an inventory. */}
              <ul className="divide-y divide-border border-y border-border leading-6 text-muted">
                {exportInventory.map((itemKey) => (
                  <li key={itemKey} className="flex gap-3 py-4">
                    <DiveDayIcon name="check" className="mt-1 size-4 shrink-0 text-primary" />
                    <span>{t(itemKey)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* One door to the whole switching surface, closing the band rather
            than belonging to either half: the hub fronts every incumbent guide,
            so two stacked link CTAs here were one door pretending to be two.
            The rule above it is load-bearing now that the arriving column ends
            in a link of its own: the left column is the taller one (a mockup
            against a four-row list), so without a full-width line between them
            these two land at the same left margin a short gap apart and scan as
            a stacked pair — the exact shape the 2026-08-13 redesign removed,
            reached from a different direction. The rule says this one closes
            both columns. */}
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

      {/* The one close. Until 2026-08-13 the page ended on three consecutive
          banded CTAs (a mid-page demo card, a "Try it" band, a contact band);
          they merged into this single band — ask, price, and the human path,
          in that order. */}
      <MarketingReveal>
        <section className="border-t border-border bg-surface">
          <div className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-28">
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
                {t("marketing.home.tryTitle")}
              </h2>
              <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted">
                {t("marketing.home.tryDescription")}
              </p>
              <FunnelCtas locale={locale} source="home-closing" className="mt-8 justify-center" />
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
                {/* An `h2` at `text-xl`: the human path is a top-level way out of
                  this page, not a footnote under the demo — a buyer who will
                  not self-serve either button needs it in the outline. Level
                  and size are separate decisions; it sits quietly on purpose. */}
                <h2 className="text-xl font-semibold tracking-tight">
                  {t("marketing.home.contactTitle")}
                </h2>
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
      </MarketingReveal>
    </main>
  );
}
