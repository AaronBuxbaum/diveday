import { cacheLife } from "next/cache";
import Link from "next/link";
import { FunnelCtas } from "@/app/_components/FunnelCtas";
import { JsonLd } from "@/components/JsonLd";
import { MarketingHeroMotion, MarketingReveal } from "@/components/MarketingReveal";
import { MarginNotes } from "@/components/MarketingSections";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass } from "@/components/ui/button";
import {
  BANNER_TITLE_CLASS,
  DISPLAY_TITLE_CLASS,
  ITEM_TITLE_CLASS,
  SUB_TITLE_CLASS,
} from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import {
  type FeaturePageSlug,
  featurePagePath,
  getFeaturePage,
  relatedFeaturePages,
} from "@/lib/feature-pages";
import { featureSource } from "@/lib/funnel";
import { capabilityGroup, earlyAccessPrice, fullShopExport } from "@/lib/marketing";
import { FeatureScreen } from "./FeatureScreen";

/**
 * One row of the inventory, in or out: a rule under every row, and over the
 * first row of each column (the second row is the right column's first from
 * `sm`).
 */
const INVENTORY_ROW_CLASS =
  "flex gap-3 border-b border-border py-3.5 leading-6 first:border-t sm:[&:nth-child(2)]:border-t";

/**
 * **One feature page**, the same six parts for all twelve (H-93): what the
 * shop gets, with the screen that does it and the builder's notes under it;
 * how it works in three steps; everything in it; the questions shops ask;
 * the close; and last the pages a reader asks about next.
 *
 * The order is the order a shop owner's doubts arrive in. The headline and the
 * screen answer "does it do the thing", and the price under the doors answers
 * the question that comes straight after it. The steps answer "how much work
 * is it for us", the inventory answers "does it do *all* of the thing" with a
 * competitor's page open beside it, and the questions answer the objections, leaving included, before the close asks for
 * anything. The close ends the argument, and the related pages come after it
 * for the reader who is not ready yet (conversion review, 2026-10-05). The
 * demo door sits at the top and again in the close, and both open the demo on
 * the screen this page is about (`FeaturePage.demo`); the note under the first
 * says which screen and as whom, because on four pages the drawing is the
 * diver's phone and the door lands on the staff side.
 *
 * Cached per page and negotiated locale; nothing here reads the request. The
 * forms only reference `enterDemoAction`, a Server Action reference that is
 * safe to pass through `"use cache"`.
 */
export async function FeaturePageBody({
  slug,
  locale,
}: {
  slug: FeaturePageSlug;
  locale: DiverLocale;
}) {
  "use cache";
  cacheLife("max");
  const page = getFeaturePage(slug);
  if (!page) return null;
  const t = diverTranslator(locale);
  const key = page.key;
  const name = t(`marketing.featurePages.${key}.name`);
  const notes = [
    t(`marketing.featurePages.${key}.note1`),
    t(`marketing.featurePages.${key}.note2`),
    t(`marketing.featurePages.${key}.note3`),
  ];
  const steps = [
    {
      title: t(`marketing.featurePages.${key}.step1Title`),
      body: t(`marketing.featurePages.${key}.step1Body`),
    },
    {
      title: t(`marketing.featurePages.${key}.step2Title`),
      body: t(`marketing.featurePages.${key}.step2Body`),
    },
    {
      title: t(`marketing.featurePages.${key}.step3Title`),
      body: t(`marketing.featurePages.${key}.step3Body`),
    },
  ];
  const questions = [
    { q: t(`marketing.featurePages.${key}.faq1Q`), a: t(`marketing.featurePages.${key}.faq1A`) },
    { q: t(`marketing.featurePages.${key}.faq2Q`), a: t(`marketing.featurePages.${key}.faq2A`) },
    { q: t(`marketing.featurePages.${key}.faq3Q`), a: t(`marketing.featurePages.${key}.faq3A`) },
  ];
  const included = capabilityGroup(key);
  const related = relatedFeaturePages(page);
  const price = {
    price: earlyAccessPrice.price,
    cadence: t(earlyAccessPrice.cadenceKey),
  };

  return (
    <main className="flex-1">
      {/* The questions, as the search engines read them: the same three a
          reader sees below, in the reader's own language. */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: questions.map(({ q, a }) => ({
            "@type": "Question",
            name: q,
            acceptedAnswer: { "@type": "Answer", text: a },
          })),
        }}
      />

      {/* The claim and its proof side by side: the headline, the pitch and
          the doors on the left; the screen with its notes on the right. On a
          phone the screen follows the doors, so the first thing to tap is
          still the demo.

          `minmax(0, …)` tracks, not `1fr` alone: a bare `1fr` is `minmax(auto,
          1fr)`, so one row in a drawing that will not wrap (the Spanish roll
          call's two buttons) widened the whole column past a 390px phone and
          left a 3px gutter (design review, 2026-10-05). `lg:pt-2.5` sets the
          breadcrumb on the same line as the panel's first line. */}
      <section className="border-b border-border">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-[minmax(0,1fr)] gap-12 px-6 py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start lg:gap-16 lg:py-20">
          <div className="max-w-2xl lg:pt-2.5">
            <nav aria-label={t("marketing.featureChrome.breadcrumbLabel")}>
              <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <li>
                  <Link
                    href="/product"
                    className="font-medium text-muted underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {t("marketing.featureChrome.breadcrumb")}
                  </Link>
                </li>
                <li aria-hidden="true" className="text-muted">
                  <DiveDayIcon name="chevron-right" className="size-3.5" />
                </li>
                <li aria-current="page" className="font-semibold text-primary">
                  {name}
                </li>
              </ol>
            </nav>
            <h1 className={`mt-5 ${DISPLAY_TITLE_CLASS} sm:text-5xl`}>
              {t(`marketing.featurePages.${key}.title`)}
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-muted">
              {t(`marketing.featurePages.${key}.lede`)}
            </p>
            <FunnelCtas
              locale={locale}
              source={featureSource(page.slug)}
              demo={page.demo}
              className="mt-8"
            />
            <p className="mt-3 text-sm font-medium text-muted">
              {t("marketing.featureChrome.demoNote", {
                place: t(`marketing.featurePages.${key}.demoPlace`),
              })}
            </p>
            {/* The price at the first door, as on `/` and `/product`: a page
                reached from a search is the most evaluating landing on the
                site, and "what does it cost" is its second question. */}
            <p className="mt-2 text-sm text-muted">{t("marketing.home.heroPriceLine", price)}</p>
          </div>
          <MarketingHeroMotion>
            {/* The roll call is a phone, narrower than the column, so its
                figure narrows with it and the notes sit under the phone
                rather than out past its edges. */}
            <figure className={page.screen === "rollCall" ? "mx-auto w-full max-w-sm" : "w-full"}>
              <FeatureScreen
                screen={page.screen}
                label={t(`marketing.featurePages.${key}.screenLabel`)}
                locale={locale}
              />
              <figcaption className="mt-6">
                <MarginNotes notes={notes} className="max-w-xl" />
              </figcaption>
            </figure>
          </MarketingHeroMotion>
        </div>
      </section>

      {/* How it works: three steps in the order the shop meets them, as a
          numbered track rather than three equal boxes, because they are a
          sequence. Numbered as the notes above are, in plain figures: two
          numbering styles one scroll apart read as two systems. */}
      <MarketingReveal>
        <section className="bg-surface">
          <div className="mx-auto w-full max-w-7xl px-6 py-16 lg:py-20">
            <h2 className={`${BANNER_TITLE_CLASS} sm:text-4xl`}>
              {t("marketing.featureChrome.stepsTitle")}
            </h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-3 md:gap-10">
              {steps.map((step, index) => (
                <li key={step.title} className="flex gap-3 border-t border-border pt-5">
                  <span
                    aria-hidden="true"
                    className="w-4 shrink-0 leading-7 font-semibold text-primary tabular-nums"
                  >
                    {index + 1}
                  </span>
                  <div>
                    <h3 className={`${ITEM_TITLE_CLASS} text-balance`}>{step.title}</h3>
                    <p className="mt-2 leading-7 text-muted">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </MarketingReveal>

      {/* Everything in it: the whole group from the capability index, the
          list a buyer reads against a competitor's feature page. The two
          "What it doesn't do" rows that ended it were cut (Aaron, 2026-10-06):
          a sales page lists what a shop gets. Beside it, the plan's terms: the price, where "is all of this extra?" is
          asked, and how leaving works, the third pillar of the positioning in
          the words `/product` and the pricing FAQ use (`fullShopExport`). */}
      <MarketingReveal>
        <section className="mx-auto w-full max-w-7xl px-6 py-16 lg:py-20">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
            <div>
              <h2 className={`${BANNER_TITLE_CLASS} sm:text-4xl`}>
                {t("marketing.featureChrome.includedTitle")}
              </h2>
              <p className="mt-4 leading-7 text-muted">
                {t("marketing.featureChrome.includedPrice", price)}
              </p>
              <Link
                href="/pricing"
                className={buttonClass({ variant: "link", flush: true, className: "mt-2" })}
              >
                {t("marketing.featureChrome.pricingLink")}
              </Link>
              <p className="mt-6 border-t border-border pt-5 leading-7 text-muted">
                {t("marketing.product.leavingNote", { terms: t(fullShopExport.termsKey) })}
              </p>
            </div>
            <div>
              {/* The rule above each column's first row rather than across
                  the list: a rule on the `ul` ran through the gutter the row
                  rules stop at. */}
              <ul className="grid gap-x-10 sm:grid-cols-2">
                {included.items.map((itemKey) => (
                  <li key={itemKey} className={INVENTORY_ROW_CLASS}>
                    <DiveDayIcon name="check" className="mt-1 size-4 shrink-0 text-primary" />
                    <span>{t(itemKey)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </MarketingReveal>

      {/* The questions shops ask, on the same two columns and at the same
          heading size as the list above it, so the page's middle reads as
          one hand rather than a template's three. */}
      <MarketingReveal>
        <section className="border-t border-border">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-6 py-16 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16 lg:py-20">
            <h2 className={`${BANNER_TITLE_CLASS} sm:text-4xl`}>
              {t("marketing.featureChrome.faqTitle")}
            </h2>
            <dl className="divide-y divide-border border-y border-border">
              {questions.map(({ q, a }) => (
                <div key={q} className="py-5">
                  <dt className="font-semibold text-pretty">{q}</dt>
                  <dd className="mt-2 leading-7 text-muted">{a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </MarketingReveal>

      {/* The close: the same two doors, tagged as this page's second
          position, and the price once more beside them. It comes straight
          after the objections, so the ask lands at the end of the argument. */}
      <MarketingReveal>
        <section className="border-t border-border">
          <div className="mx-auto w-full max-w-3xl px-6 py-20 text-center lg:py-24">
            <h2 className={`${BANNER_TITLE_CLASS} sm:text-4xl`}>
              {t(`marketing.featurePages.${key}.closeTitle`)}
            </h2>
            <FunnelCtas
              locale={locale}
              source={featureSource(page.slug, "close")}
              demo={page.demo}
              className="mt-8 justify-center"
            />
            <p className="mt-3 text-sm font-medium text-balance text-muted">
              {t("marketing.common.setUpNote")}
            </p>
            <p className="mt-6 font-medium text-balance">
              {t("marketing.featureChrome.closePrice", price)}
            </p>
          </div>
        </section>
      </MarketingReveal>

      {/* What a reader asks about next, and the way back to the whole list:
          last, for the reader the close did not convince yet. */}
      <MarketingReveal>
        <section className="border-t border-border bg-surface">
          <div className="mx-auto w-full max-w-7xl px-6 py-16 lg:py-20">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <h2 className={`${SUB_TITLE_CLASS} sm:text-2xl`}>
                {t("marketing.featureChrome.relatedTitle")}
              </h2>
              <Link href="/product" className={buttonClass({ variant: "link", flush: true })}>
                {t("marketing.featureChrome.allFeatures")}
              </Link>
            </div>
            <ul className="mt-8 grid gap-4 md:grid-cols-3">
              {related.map((other) => (
                <li key={other.slug}>
                  <Link
                    href={featurePagePath(other.slug)}
                    className="group flex h-full flex-col rounded-panel border border-border bg-background p-5 transition-colors hover:border-primary"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className={ITEM_TITLE_CLASS}>
                        {t(`marketing.featurePages.${other.key}.name`)}
                      </span>
                      <DiveDayIcon
                        name="arrow-right"
                        className="size-4 shrink-0 text-muted transition-colors group-hover:text-primary"
                      />
                    </span>
                    <span className="mt-2 text-sm leading-6 text-muted">
                      {t(`marketing.featurePages.${other.key}.summary`)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </MarketingReveal>
    </main>
  );
}
