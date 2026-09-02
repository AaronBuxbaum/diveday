import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { FunnelCtas } from "@/app/_components/FunnelCtas";
import { MarketingNav, MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { MarketingHeroMotion, MarketingSectionMotion } from "@/components/MarketingReveal";
import {
  DiverBookingFallback,
  FrontDeskReadinessFallback,
  NightBeforeBriefFallback,
  RecapPageFallback,
  ShopPrepListFallback,
} from "@/components/MarketingScreenFallbacks";
import { CaptainPhoneFrame, MarketingMockup } from "@/components/MarketingSections";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { groupLabelClass } from "@/components/ui/ledger";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import type { DiverLocale } from "@/i18n/settings";
import { switchingHref } from "@/lib/funnel";
import {
  earlyAccessPrice,
  fullShopExport,
  productCapabilityIndex,
  sharedLinkCard,
} from "@/lib/marketing";
import { ProductChapterNav } from "./_components/ProductChapterNav";

// `instant = true`: navigating here paints immediately. The request-scoped
// read this page makes (`requestLocale()`) sits behind this segment's
// `loading.tsx` — the boundary of record for a page — so the frame lands
// without waiting on the request. `next build` audits the claim. See ADR
// 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Product — booking to head count | DiveDay",
  description:
    "How DiveDay runs a dive shop's day: bookings, waivers, cert checks, trip prep, and a boat manifest that keeps working when the signal doesn't.",
  alternates: { canonical: "/product" },
  openGraph: {
    ...sharedLinkCard,
    title: "The DiveDay product — booking to head count",
    description:
      "Bookings, waivers, cert checks, trip prep, and the boat manifest, organized around the trip itself.",
    url: "/product",
  },
  // `summary_large_image`: the OG block above names the shared link card
  // (`sharedLinkCard` → `src/app/opengraph-image.tsx`), so the large card has an
  // image to fill it (docs/product/marketing.md, Twitter-card policy). Title and
  // description are restated here rather than left to inherit, so a shared link
  // never unfurls with the root layout's generic site-level words.
  twitter: {
    card: "summary_large_image",
    title: "The DiveDay product — booking to head count",
    description:
      "Bookings, waivers, cert checks, trip prep, and the boat manifest, organized around the trip itself.",
  },
};

/**
 * The body renders **once**, in the reader's own language.
 *
 * Until 2026-08-14 this page wrapped the body in a `<Suspense>` whose fallback
 * was `<ProductBody locale={DEFAULT_DIVER_LOCALE} />` — the whole page, a
 * second time, in English. That bought the instant paint, and it cost the
 * visitor everything they did before the negotiated-locale body resolved: a
 * replaced subtree carries no DOM state over, so a tap on the anchor strip
 * below scrolled to a heading in a subtree that was about to be thrown away,
 * and an `es-ES` reader landed somewhere else on the page (the Spanish
 * chapters above it are taller). It was invisible in every en-US screenshot
 * and assertion, because both renders were the same words
 * (FU-20260812-marketing-suspense-swap-discards-interaction).
 *
 * The paint is still instant, and it is `loading.tsx` — this segment's
 * `<Suspense>` boundary, the arrangement ADR 20260804-instant-navigation
 * already establishes — that makes it so. Nothing in that skeleton is
 * interactive, so there is nothing to lose when the real body lands. The nav
 * keeps its own boundary because it reads the *session* as well as the locale;
 * the body must not wait on that.
 */
export default async function ProductPage() {
  const locale = await requestLocale();
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
      <ProductBody locale={locale} />
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </div>
  );
}

/**
 * The five chapters of the day, in the order the day runs them. This list is
 * the only place the sequence exists: the anchor strip under the hero, each
 * chapter's marker, and the `#id` they jump between all derive from it, so it
 * cannot disagree with itself. Reordering it renumbers everything at once.
 */
const CHAPTER_IDS = ["booking", "readiness", "night-before", "dock", "recap"] as const;
type ChapterId = (typeof CHAPTER_IDS)[number];
type ChapterMark = { id: ChapterId; label: string; number: string };

/**
 * The shared grammar of the day-arc chapters: a quiet numbered time-of-day
 * marker in the slot the eyebrow used to hold. The number is muted and the
 * time label carries the accent, so five of these read as one sequence while
 * each chapter's composition below stays its own.
 */
function ChapterMarker({ mark, centered = false }: { mark: ChapterMark; centered?: boolean }) {
  const { number, label } = mark;
  return (
    <p
      className={`flex items-baseline gap-3 text-sm font-semibold tracking-widest uppercase ${
        centered ? "justify-center" : ""
      }`}
    >
      <span className="text-muted tabular-nums">{number}</span>
      <span className="text-primary">{label}</span>
    </p>
  );
}

/** Cached per negotiated locale (DIVER_LOCALES — two entries) — no session-scoped content. */
async function ProductBody({ locale }: { locale: DiverLocale }) {
  "use cache";
  cacheLife("max");
  const t = diverTranslator(locale);

  const chapterLabels: Record<ChapterId, string> = {
    booking: t("marketing.product.bookingEyebrow"),
    readiness: t("marketing.product.readinessEyebrow"),
    "night-before": t("marketing.product.nightBeforeEyebrow"),
    dock: t("marketing.product.dockEyebrow"),
    recap: t("marketing.product.recapEyebrow"),
  };
  const chapters: ChapterMark[] = CHAPTER_IDS.map((id, index) => ({
    id,
    label: chapterLabels[id],
    number: `0${index + 1}`,
  }));
  // Looked up by name below rather than numbered by hand: a literal "04" on
  // the dock chapter would go on reading 04 after the list above it changed.
  const chapter = Object.fromEntries(chapters.map((mark) => [mark.id, mark])) as Record<
    ChapterId,
    ChapterMark
  >;

  // Every line in the reference index below, counted once so the sentence
  // introducing it and the list itself can never disagree.
  const capabilityCount = productCapabilityIndex.reduce(
    (total, group) => total + group.items.length,
    0,
  );

  const notCovered = [
    {
      title: t("marketing.product.notCovered.pos.title"),
      detail: t("marketing.product.notCovered.pos.detail"),
    },
    {
      title: t("marketing.product.notCovered.workOrders.title"),
      detail: t("marketing.product.notCovered.workOrders.detail"),
    },
    // "Gear serial numbers" used to sit here, saying DiveDay tracked sizes but
    // not individual units or service history. The gear register shipped
    // 2026-08-15 (ADR 20260815-minimal-gear-register) and does both — one row
    // per tagged unit, who has it, when it is due back, and its service clocks
    // — so the claim was false the day it shipped. A "what we don't do" list is
    // only worth anything while every line on it is true.
    {
      title: t("marketing.product.notCovered.agencyLine.title"),
      detail: t("marketing.product.notCovered.agencyLine.detail"),
    },
  ] as const;

  return (
    <main className="flex-1">
      <MarketingSectionMotion />
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
          <FunnelCtas locale={locale} source="product" className="mt-8 justify-center" />
          <p className="mt-3 text-sm font-medium text-muted">{t("marketing.common.demoNote")}</p>
          <p className="mt-2 text-sm text-muted">
            {t("marketing.home.heroPriceLine", {
              price: earlyAccessPrice.price,
              cadence: t(earlyAccessPrice.cadenceKey),
            })}
          </p>
        </div>
      </section>

      {/* The day at a glance: five time-of-day markers, each an anchor into
          its chapter. Scoped in a relative container so that the sticky nav
          naturally scrolls away once the reader moves past chapter 05 (recap). */}
      <div className="relative">
        <ProductChapterNav
          ariaLabel={t("marketing.product.arcTitle")}
          title={t("marketing.product.arcTitle")}
          chapters={chapters}
        />

        {/* Chapter 01 — days before: the booking takes itself. */}
        <section id="booking" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-20 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <ChapterMarker mark={chapter.booking} />
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
                {t("marketing.product.bookingTitle")}
              </h2>
              <p className="mt-5 text-lg leading-8 text-muted">
                {t("marketing.product.bookingDescription")}
              </p>
              <ul className="mt-7 space-y-3 border-l-2 border-border pl-5 text-sm leading-6 text-muted">
                <li>{t("marketing.product.bookingPoint1")}</li>
                <li>{t("marketing.product.bookingPoint2")}</li>
                <li>{t("marketing.product.bookingPoint3")}</li>
              </ul>
            </div>
            <MarketingMockup
              label={t("marketing.product.bookingMockupLabel")}
              className="shadow-xl shadow-foreground/5"
            >
              <DiverBookingFallback locale={locale} />
            </MarketingMockup>
          </div>
        </section>

        {/* Chapter 02 — before departure: one readiness answer. Mirrors chapter
            01's grid so the two read as a pair — the mockup swaps sides. */}
        <section id="readiness" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-20 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <MarketingMockup
              label={t("marketing.product.readinessMockupLabel")}
              className="order-2 shadow-xl shadow-foreground/5 lg:order-1"
            >
              <FrontDeskReadinessFallback locale={locale} />
            </MarketingMockup>
            <div className="order-1 lg:order-2">
              <ChapterMarker mark={chapter.readiness} />
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
                {t("marketing.product.readinessTitle")}
              </h2>
              <p className="mt-5 text-lg leading-8 text-muted">
                {t("marketing.product.readinessDescription")}
              </p>
              <ol className="mt-7 space-y-3 text-sm leading-6 text-muted">
                <li className="flex gap-3">
                  <span className="font-semibold text-primary tabular-nums">1</span>
                  {t("marketing.product.readinessStep1")}
                </li>
                <li className="flex gap-3">
                  <span className="font-semibold text-primary tabular-nums">2</span>
                  {t("marketing.product.readinessStep2")}
                </li>
                <li className="flex gap-3">
                  <span className="font-semibold text-primary tabular-nums">3</span>
                  {t("marketing.product.readinessStep3")}
                </li>
              </ol>
            </div>
          </div>
        </section>

        {/* Chapter 03 — the night before: showing both the crew's prep list
            and the diver's brief alongside live mockups of each. */}
        <section id="night-before" className="scroll-mt-24 border-y border-border bg-surface">
          <div className="mx-auto max-w-6xl px-6 py-20 lg:py-24">
            <div>
              <ChapterMarker mark={chapter["night-before"]} />
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
                {t("marketing.product.prepTitle")}
              </h2>
            </div>
            <div className="mt-12 grid gap-10 md:grid-cols-2 lg:gap-12 items-start">
              <div className="space-y-6">
                <div>
                  <p className={groupLabelClass()}>{t("marketing.product.prepShopLabel")}</p>
                  <h3 className="mt-2 text-xl font-semibold tracking-tight">
                    {t("marketing.product.prepShopTitle")}
                  </h3>
                  <p className="mt-2 leading-7 text-muted">{t("marketing.product.prepShopBody")}</p>
                </div>
                <MarketingMockup
                  label={t("marketing.product.prepShopMockupLabel")}
                  className="shadow-xl shadow-foreground/5"
                >
                  <ShopPrepListFallback locale={locale} />
                </MarketingMockup>
              </div>
              <div className="space-y-6">
                <div>
                  <p className={groupLabelClass()}>{t("marketing.product.prepDiverLabel")}</p>
                  <h3 className="mt-2 text-xl font-semibold tracking-tight">
                    {t("marketing.product.nightBeforeTitle")}
                  </h3>
                  <p className="mt-2 leading-7 text-muted">
                    {t("marketing.product.nightBeforeBody")}
                  </p>
                </div>
                <MarketingMockup
                  label={t("marketing.product.nightBeforeMockupLabel")}
                  className="shadow-xl shadow-foreground/5"
                >
                  <NightBeforeBriefFallback locale={locale} />
                </MarketingMockup>
              </div>
            </div>
          </div>
        </section>

        {/* Chapter 04 — at the dock: the differentiator gets the phone. */}
        <section id="dock" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-20 lg:py-24">
          {/* The phone gets the narrower column, not the wider one: it is a
              fixed 384px object, so a 1.1fr column left it floating in ~110px of
              slack on either side and pushed the story it illustrates away from
              it. */}
          <div className="grid gap-10 lg:grid-cols-[0.85fr_1fr] lg:items-center">
            <div className="order-2 lg:order-1">
              <MarketingHeroMotion>
                <CaptainPhoneFrame
                  label={t("marketing.product.captainPhoneLabel")}
                  locale={locale}
                  className="mx-auto max-w-sm"
                />
              </MarketingHeroMotion>
            </div>
            <div className="order-1 lg:order-2">
              <ChapterMarker mark={chapter.dock} />
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
              convinced reader shouldn't have to scroll the rest of the day to
              act on it (conversion review — one CTA at the bottom of ten
              sections). Tagged `product-mid` rather than `product`: folded into
              the page's own tag it could never be shown to have earned its
              place, and the hero/closing pair keeps the original tag so their
              history holds. */}
          <SectionCard
            as="div"
            padding="lg"
            className="mt-14 flex flex-col items-center gap-4 text-center sm:flex-row sm:justify-between sm:text-left"
          >
            <h3 className="text-xl font-semibold tracking-tight">
              {t("marketing.common.midCtaTitle")}
            </h3>
            <FunnelCtas locale={locale} source="product-mid" size="md" />
          </SectionCard>
        </section>

        {/* Chapter 05 — after the boat is back: the day's earned moment, so the
            chapter narrows to a single centered thought instead of a grid. */}
        <section id="recap" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-20 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
            <div>
              <ChapterMarker mark={chapter.recap} />
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
                {t("marketing.product.recapTitle")}
              </h2>
              <p className="mt-5 text-lg leading-8 text-muted">
                {t("marketing.product.recapDescription")}
              </p>
              <p className="mt-4 leading-7 text-muted">{t("marketing.product.afterTripBody")}</p>
            </div>
            <MarketingMockup
              label={t("marketing.product.recapMockupLabel")}
              className="shadow-xl shadow-foreground/5"
            >
              <RecapPageFallback locale={locale} />
            </MarketingMockup>
          </div>
        </section>
      </div>

      {/* Money is not a chapter — it runs under every one of them, so it sits
          just outside the numbered arc with the plain eyebrow grammar. */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-20 lg:py-24">
          <div className="max-w-2xl">
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
          {/* Two facts, held to the same 4xl measure as the paragraph above
              them: stretched across the full 6xl grid each line ran ~95
              characters, which is a wall, not a fact. */}
          <dl className="mt-12 grid max-w-4xl gap-x-12 gap-y-8 md:grid-cols-2">
            <div className="border-t border-border pt-5">
              <dt className="font-semibold leading-6">{t("marketing.product.yourAccountTitle")}</dt>
              <dd className="mt-2 text-sm leading-6 text-muted">
                {t("marketing.product.yourAccountBody")}
              </dd>
            </div>
            <div className="border-t border-border pt-5">
              <dt className="font-semibold leading-6">{t("marketing.product.pricedTitle")}</dt>
              <dd className="mt-2 text-sm leading-6 text-muted">
                {t("marketing.product.pricedBody")}
              </dd>
            </div>
          </dl>
          {/* "What is this going to cost me" is one of the three questions a
              burned owner arrives with, and this band — the only one on the
              page about money — raised it, answered the other party's half, and
              parked our own half behind a click ("What DiveDay itself costs →")
              until 2026-08-28. An unlabeled door on the one band about money is
              what a burned buyer reads as a card wall
              (docs/product/marketing-review-20260827.md, diagnosis 2), so the
              figure now stands in the link's own words.

              It costs the page no control: this door already existed, and the
              number arrives inside it rather than beside it. That is the same
              move the homepage hero made — state the fact, do not open a
              second door to it (docs/product/marketing.md, "The budget binds
              controls, not facts").

              Interpolated, never spelled: `earlyAccessPrice` is the single
              source H-12 requires, and `src/lib/marketing.test.ts` now counts
              this key among the sentences that must carry `{price}` and
              `{cadence}`. */}
          <Link
            href="/pricing"
            className={buttonClass({ variant: "link", flush: true, className: "mt-8 text-left" })}
          >
            {t("marketing.product.pricingLink", {
              price: earlyAccessPrice.price,
              cadence: t(earlyAccessPrice.cadenceKey),
            })}
          </Link>
        </div>
      </section>

      {/* The reference index: every shipped capability, set like a spec sheet
          — group name on the left, terse lines flowing in two columns on the
          right, hairline rules between groups. No cards, no check marks, and
          no disclosure: a section headed "the whole list, plainly" that showed
          a heading, two lines, and a "The full list" link in 350px of empty
          band was the emptiest thing on the page. Rendering it flat also puts
          it in find-in-page and in the accessibility tree. It was once out of
          reach of the localized-body swap that snapped the disclosure shut
          mid-click as well; that swap is gone (see `ProductPage`), so a
          disclosure here would be safe again — it is still flat because the
          band read better this way. */}
      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-6xl px-6 py-20 lg:py-28">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              {t("marketing.product.boxEyebrow")}
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
              {t("marketing.product.boxTitle")}
            </h2>
            {/* Counted off the registry rather than written down, so the
                number can never drift from the list printed under it. */}
            <p className="mt-4 text-lg leading-8 text-muted">
              {t("marketing.product.boxDescription", { count: capabilityCount })}
            </p>
          </div>
          <div className="mt-14">
            {productCapabilityIndex.map((group) => (
              <section
                key={group.title}
                className="grid gap-x-12 gap-y-3 border-t border-border py-8 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]"
              >
                <h3 className="text-base font-semibold tracking-tight text-balance">
                  {t(group.title)}
                </h3>
                <ul className="gap-x-12 text-sm leading-6 text-muted sm:columns-2">
                  {group.items.map((item) => (
                    <li key={item} className="break-inside-avoid py-1">
                      {t(item)}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {/* The dare gets a door. This band's lede makes the page's most
                explicit promise — every one of these lines is something you
                can go and do in the live demo right now — and then left it
                unspent: the reader who took the dare had two more bands to
                scroll before anything let them act
                (docs/product/marketing-review-20260827.md, "the dare gets a
                door"). Tagged `product-index`, registered beside
                `product-mid`, so the inventory's own conversion can be read
                apart from the dock story's and from the page total.

                It carries no words of its own, deliberately. The lede above is
                the caption — a heading here would be the sentence restating
                its own section that copy-restraint deletes, and the two
                candidates on this page are already taken ("Rather see it than
                read about it?" heads the mid-page card two bands up; the
                closing band names the roles). So the door reads as the list's footer,
                the way the homepage records band's closing link does: a rule
                that terminates the hairlines above it, then the pair, at the
                same left margin as the group rail. No card either — this band
                is a spec sheet, and a rounded box at the bottom of it would be
                the one object in the section that isn't a hairline. */}
            <div className="border-t border-border pt-8">
              <FunnelCtas locale={locale} source="product-index" size="md" />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20 lg:py-24">
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
        <dl className="mt-12 grid gap-x-12 gap-y-8 md:grid-cols-3">
          {notCovered.map((item) => (
            <div key={item.title} className="border-t border-border pt-5">
              <dt className="font-semibold leading-6">{item.title}</dt>
              <dd className="mt-2 text-sm leading-6 text-muted">{item.detail}</dd>
            </div>
          ))}
        </dl>
        {/* Safe-to-leave, said where the objection actually peaks. It is one
            third of the positioning spine and the named counter to "you're new
            and unproven" (docs/product/marketing.md), and until now `/product`
            only implied it — one line inside a reference list of ninety-odd. The
            terms come from the shared `fullShopExport` claim rather than a
            second wording of it, so this page and the pricing FAQ can never
            drift apart. */}
        <p className="mt-12 max-w-3xl text-lg leading-8 text-muted">
          {t("marketing.product.leavingNote", { terms: t(fullShopExport.termsKey) })}
        </p>
      </section>

      <section className="border-t border-border bg-surface">
        {/* `max-w-6xl`, like every band above it. At 7xl this one sat 64px
            further left than the rest of the page at desktop width — the only
            section whose left edge missed the column. */}
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-6 py-14 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {t("marketing.product.closingTitle")}
            </h2>
            <p className="mt-2 text-muted">{t("marketing.product.closingDescription")}</p>
            {/* Tagged, like the homepage's two doors onto the same surface:
                the question that put a direct spreadsheet door on `/` is which
                door a spreadsheet shop takes, and an untagged one here would
                have left it read against a denominator missing the page a
                reader reaches *after* the homepage convinced them. */}
            <Link
              href={switchingHref("/switching/spreadsheet", "product-spreadsheet")}
              className={buttonClass({ variant: "link", flush: true, className: "mt-2 text-left" })}
            >
              {t("marketing.product.spreadsheetLink")}
            </Link>
          </div>
          {/* `shrink-0` matters: without it the closing text squeezes both
              buttons into ~140px three-line blobs at tablet widths. */}
          <FunnelCtas locale={locale} source="product" className="shrink-0" />
        </div>
      </section>
    </main>
  );
}
