import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { MarketingNav, MarketingNavFallback } from "@/components/MarketingNav";
import {
  DiverBookingFallback,
  FrontDeskReadinessFallback,
} from "@/components/MarketingScreenFallbacks";
import { CaptainPhoneFrame, MarketingMockup } from "@/components/MarketingSections";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE, type DiverLocale } from "@/i18n/settings";
import { trialHref } from "@/lib/funnel";
import { fullShopExport, productCapabilityIndex, sharedLinkCard } from "@/lib/marketing";

// `instant = true`: navigating here paints immediately. Every request-scoped
// read sits behind a `<Suspense>` boundary — this segment's `loading.tsx`, or
// one placed inside the page — so the frame lands without waiting on the
// request. `next build` audits the claim. See ADR 20260804-instant-navigation.
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

      {/* The day at a glance: five time-of-day markers, each an anchor into
          its chapter. This strip is the page's whole table of contents — a
          buyer who only reads this line already knows the product covers the
          day end to end. */}
      <nav aria-label={t("marketing.product.arcTitle")} className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-8 px-6 py-2 text-sm">
          <p className="py-2.5 font-semibold">{t("marketing.product.arcTitle")}</p>
          {/* Two aligned columns on a phone rather than a free wrap: five
              labels of five different widths wrapping raggedly read as an
              accident, and a horizontal scroller would hide half the day — the
              whole point of this strip is that a visitor sees all five
              chapters at once. `auto` on the first column, not `grid-cols-2`:
              equal halves are 171px at 390px wide, which is narrower than the
              longest label in either locale ("After the boat is back", "Con el
              barco de vuelta") and broke it over two lines with its number
              floating beside them. */}
          <ol className="grid grid-cols-[auto_1fr] gap-x-4 sm:flex sm:flex-wrap sm:gap-x-8">
            {chapters.map((mark) => (
              <li key={mark.id}>
                <a
                  href={`#${mark.id}`}
                  className="flex min-h-11 items-center gap-2 font-medium text-muted transition-colors hover:text-foreground"
                >
                  <span className="text-xs tabular-nums">{mark.number}</span>
                  {mark.label}
                </a>
              </li>
            ))}
          </ol>
        </div>
      </nav>

      {/* Chapter 01 — days before: the booking takes itself. */}
      <section id="booking" className="mx-auto max-w-6xl scroll-mt-6 px-6 py-20 lg:py-24">
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
      <section id="readiness" className="mx-auto max-w-6xl scroll-mt-6 px-6 py-20 lg:py-24">
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

      {/* Chapter 03 — the night before: a quieter band with no mockup. The
          evening splits in two — the crew's prep list, the diver's brief —
          so the chapter does too, either side of one hairline. */}
      <section id="night-before" className="scroll-mt-6 border-y border-border bg-surface">
        <div className="mx-auto max-w-6xl px-6 py-20 lg:py-24">
          <div className="max-w-2xl">
            <ChapterMarker mark={chapter["night-before"]} />
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
              {t("marketing.product.prepTitle")}
            </h2>
          </div>
          <div className="mt-12 grid gap-10 md:grid-cols-2 md:gap-0 md:divide-x md:divide-border">
            <div className="md:pr-10">
              <p className="text-xs font-semibold tracking-widest text-muted uppercase">
                {t("marketing.product.prepShopLabel")}
              </p>
              <h3 className="mt-3 text-xl font-semibold tracking-tight">
                {t("marketing.product.prepShopTitle")}
              </h3>
              <p className="mt-3 leading-7 text-muted">{t("marketing.product.prepShopBody")}</p>
            </div>
            <div className="md:pl-10">
              <p className="text-xs font-semibold tracking-widest text-muted uppercase">
                {t("marketing.product.prepDiverLabel")}
              </p>
              <h3 className="mt-3 text-xl font-semibold tracking-tight">
                {t("marketing.product.nightBeforeTitle")}
              </h3>
              <p className="mt-3 leading-7 text-muted">{t("marketing.product.nightBeforeBody")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Chapter 04 — at the dock: the differentiator gets the phone. */}
      <section id="dock" className="mx-auto max-w-6xl scroll-mt-6 px-6 py-20 lg:py-24">
        {/* The phone gets the narrower column, not the wider one: it is a
            fixed 384px object, so a 1.1fr column left it floating in ~110px of
            slack on either side and pushed the story it illustrates away from
            it. */}
        <div className="grid gap-10 lg:grid-cols-[0.85fr_1fr] lg:items-center">
          <div className="order-2 lg:order-1">
            <CaptainPhoneFrame
              label={t("marketing.product.captainPhoneLabel")}
              locale={locale}
              className="mx-auto max-w-sm"
            />
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
        <div className="mt-14 flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface px-6 py-8 text-center sm:flex-row sm:justify-between sm:text-left">
          <h3 className="text-xl font-semibold tracking-tight">
            {t("marketing.common.midCtaTitle")}
          </h3>
          <div className="flex flex-col gap-3 sm:flex-row">
            <form action={enterDemoAction}>
              <FunnelTag source="product-mid" />
              <SubmitButton
                pendingLabel={t("marketing.product.gettingDemoReady")}
                className={buttonClass({ className: "cursor-pointer disabled:opacity-70" })}
              >
                {t("marketing.common.tryDemo")}
              </SubmitButton>
            </form>
            <Link
              href={trialHref("product-mid")}
              className={buttonClass({ variant: "secondary", className: "border-border-strong" })}
            >
              {t("marketing.common.startTrial")}
            </Link>
          </div>
        </div>
      </section>

      {/* Chapter 05 — after the boat is back: the day's earned moment, so the
          chapter narrows to a single centered thought instead of a grid. */}
      <section id="recap" className="mx-auto max-w-3xl scroll-mt-6 px-6 py-20 text-center lg:py-24">
        <ChapterMarker mark={chapter.recap} centered />
        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
          {t("marketing.product.recapTitle")}
        </h2>
        <p className="mt-5 text-lg leading-8 text-muted">
          {t("marketing.product.recapDescription")}
        </p>
        <div className="mx-auto mt-8 max-w-xl rounded-2xl border border-border bg-surface p-6 text-left sm:p-8">
          <p className="text-xs font-semibold tracking-widest text-primary uppercase">
            {t("marketing.product.recapCardLabel")}
          </p>
          <p className="mt-3 leading-7 text-muted">{t("marketing.product.afterTripBody")}</p>
        </div>
      </section>

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
              page about money — answered the other party's half of it and left
              ours to the nav. A link, not the figure: the price has exactly one
              source (`earlyAccessPrice`, H-12) and one page that argues it. */}
          <Link
            href="/pricing"
            className={buttonClass({ variant: "link", flush: true, className: "mt-8 text-left" })}
          >
            {t("marketing.product.pricingLink")}
          </Link>
        </div>
      </section>

      {/* The reference index: every shipped capability, set like a spec sheet
          — group name on the left, terse lines flowing in two columns on the
          right, hairline rules between groups. No cards, no check marks, and
          no disclosure: a section headed "the whole list, plainly" that showed
          a heading, two lines, and a "The full list" link in 350px of empty
          band was the emptiest thing on the page. Rendering it flat also puts
          it in find-in-page, in the accessibility tree, and out of reach of
          the localized-body swap that used to snap the disclosure shut
          mid-click (FU-20260812, which still stands for the pages that keep
          interactive state). */}
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
            only implied it — one line inside a 44-entry reference list. The
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
            <Link
              href="/switching/spreadsheet"
              className={buttonClass({ variant: "link", flush: true, className: "mt-2 text-left" })}
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
