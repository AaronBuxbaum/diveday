import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { FunnelCtas } from "@/app/_components/FunnelCtas";
import { MarketingNav, MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { MarketingSectionMotion } from "@/components/MarketingReveal";
import { FeatureDirectory } from "@/components/MarketingSections";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import {
  BANNER_TITLE_CLASS,
  DISPLAY_TITLE_CLASS,
  LEAD_TITLE_CLASS,
  MARKETING_EYEBROW_CLASS,
} from "@/components/ui/typography";
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

// `instant = true`: navigating here paints immediately. The request-scoped
// read this page makes (`requestLocale()`) sits behind this segment's
// `loading.tsx` — the boundary of record for a page — so the frame lands
// without waiting on the request. `next build` audits the claim. See ADR
// 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Dive shop software features — DiveDay",
  description:
    "Every DiveDay feature for dive shops, each with its own page: online booking, waivers and medical forms, certification checks, check-in, the boat manifest, rental gear, courses and payments.",
  alternates: { canonical: "/product" },
  openGraph: {
    ...sharedLinkCard,
    title: "DiveDay features, from the first booking to the roll call",
    description:
      "Each feature has its own page, with the screen that does the job and the demo opened on it.",
    url: "/product",
  },
  // `summary_large_image`: the OG block above names the shared link card
  // (`sharedLinkCard` → `src/app/opengraph-image.tsx`), so the large card has an
  // image to fill it (docs/product/marketing.md, Twitter-card policy). Title and
  // description are restated here rather than left to inherit, so a shared link
  // never unfurls with the root layout's generic site-level words.
  twitter: {
    card: "summary_large_image",
    title: "DiveDay features, from the first booking to the roll call",
    description:
      "Each feature has its own page, with the screen that does the job and the demo opened on it.",
  },
};

/**
 * The body renders **once**, in the reader's own language.
 *
 * Until 2026-08-14 this page wrapped the body in a `<Suspense>` whose fallback
 * was `<ProductBody locale={DEFAULT_DIVER_LOCALE} />` — the whole page, a
 * second time, in English. That bought the instant paint, and it cost the
 * visitor everything they did before the negotiated-locale body resolved: a
 * replaced subtree carries no DOM state over, so a tap on the chapter strip
 * the page had then scrolled to a heading in a subtree that was about to be
 * thrown away, and an `es-ES` reader landed somewhere else on the page (the
 * Spanish chapters above it were taller). It was invisible in every en-US
 * screenshot and assertion, because both renders were the same words
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

/** Cached per negotiated locale (DIVER_LOCALES — two entries) — no session-scoped content. */
async function ProductBody({ locale }: { locale: DiverLocale }) {
  "use cache";
  cacheLife("max");
  const t = diverTranslator(locale);

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
          <p className={MARKETING_EYEBROW_CLASS}>{t("marketing.product.eyebrow")}</p>
          <h1 className={`mt-5 ${DISPLAY_TITLE_CLASS} sm:text-6xl`}>
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

      {/* The directory: every feature page, under the part of a shop's year it
          serves. It is the page's one idea (docs/design/surfaces.md, "/product"):
          a shop owner arrives asking whether DiveDay does their job, finds the
          job by its name, and reaches its page in one tap. The rows come off the
          registry (`src/lib/feature-pages.ts`), so a page added there is listed
          here and on the homepage without either page naming it. The phases are
          this page's sections, so they are its `h2`s. */}
      <section className="mx-auto max-w-6xl px-6 py-20 lg:py-24">
        <FeatureDirectory locale={locale} headingLevel="h2" />
      </section>

      {/* The reference index: every shipped capability, set like a spec sheet
          — one hairline row per group, each row a native disclosure holding
          that group's terse lines in two columns. No cards and no check marks:
          the borders that survive are the ones that separate.

          **Closed at rest, since 2026-09-17.** Rendered flat it was ninety-odd
          one-line claims stacked nine groups deep — 2,900px of the page's
          9,600, landing after the argument (claim → price → proof → demo door,
          docs/design/surfaces.md) had already finished. Nobody reads a wall;
          what a buyer actually does here is look for their own job and count
          the breadth, and one named row per job, carrying its own count, says
          the breadth in one screen where the wall said it in eight. Every line
          is still one keystroke away, still in the accessibility tree, and
          still in the page source for find-in-page (Chromium and Firefox open
          a closed `<details>` to reveal a match).

          **The rows are the feature pages' own groups since 2026-10-05**, in
          the directory's order, then the three no single page owns (the diver
          record, running the shop, the records). The row a reader opens here
          is the "What's in it" checklist on that feature's page, word for
          word, because both read one group of `productCapabilityIndex`.

          The earlier objection to a disclosure here was a *different* shape:
          one link reading "The full list" under a heading and two lines, which
          left 350px of empty band. The group names are the list. It was also
          once out of reach of the localized-body swap that snapped a
          disclosure shut mid-click; that swap is gone (see `ProductPage`). */}
      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-6xl px-6 py-20 lg:py-24">
          <div className="max-w-2xl">
            <p className={MARKETING_EYEBROW_CLASS}>{t("marketing.product.boxEyebrow")}</p>
            <h2 className={`mt-4 ${BANNER_TITLE_CLASS} sm:text-4xl`}>
              {t("marketing.product.boxTitle")}
            </h2>
            {/* Counted off the registry rather than written down, so the
                number can never drift from the list under it. */}
            <p className="mt-4 text-lg leading-8 text-muted">
              {t("marketing.product.boxDescription", { count: capabilityCount })}
            </p>
          </div>
          <div className="mt-14">
            {productCapabilityIndex.map((group) => (
              // The row's own count, off the same registry as the lede's total
              // — it is what a closed row owes the reader, and the one thing
              // that cannot drift from what opening the row shows.
              <details key={group.title} className="group border-t border-border">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 sm:gap-6 [&::-webkit-details-marker]:hidden">
                  {/* A heading inside a `<summary>` (implicit `button` role) is
                      flattened by some screen readers' heading navigation — the
                      trade `src/components/ui/disclosure.tsx` documents, taken
                      here for the same reason: the whole row has to be the
                      control, and the band still needs its groups in the
                      outline. */}
                  <h3 className="text-base font-semibold tracking-tight text-balance">
                    {t(group.title)}
                  </h3>
                  <span className="flex shrink-0 items-center gap-3 text-sm text-muted">
                    <span className="tabular-nums">
                      {t("marketing.product.boxGroupCount", { count: group.items.length })}
                    </span>
                    <DisclosureCaret direction="down" className="group-open:rotate-180" />
                  </span>
                </summary>
                <ul className="gap-x-12 pb-8 text-sm leading-6 text-muted sm:columns-2">
                  {group.items.map((item) => (
                    <li key={item} className="break-inside-avoid py-1">
                      {t(item)}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
            {/* The dare gets a door. This band's lede makes the page's most
                explicit promise — every one of these lines is something you
                can go and do in the live demo right now — and then left it
                unspent: the reader who took the dare had two more bands to
                scroll before anything let them act
                (docs/product/marketing-review-20260827.md, "the dare gets a
                door"). Tagged `product-index`, so the inventory's own
                conversion can be read apart from the hero's and the close's.

                It carries no words of its own, deliberately. The lede above is
                the caption — a heading here would be the sentence restating
                its own section that copy-restraint deletes, and the closing
                band already says what the demo holds. So the door reads as the
                list's footer,
                the way the homepage records band's closing link does: a rule
                that terminates the hairlines above it, then the pair, at the
                same left margin as the group rows. No card either — this band
                is a spec sheet, and a rounded box at the bottom of it would be
                the one object in the section that isn't a hairline. */}
            <div className="border-t border-border pt-8">
              <FunnelCtas locale={locale} source="product-index" />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20 lg:py-24">
        <div className="max-w-2xl">
          <p className={MARKETING_EYEBROW_CLASS}>{t("marketing.product.noEyebrow")}</p>
          <h2 className={`mt-4 ${BANNER_TITLE_CLASS} sm:text-4xl`}>
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
            <h2 className={LEAD_TITLE_CLASS}>{t("marketing.product.closingTitle")}</h2>
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
