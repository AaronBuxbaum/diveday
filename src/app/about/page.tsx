import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { FunnelCtas } from "@/app/_components/FunnelCtas";
import { MarketingNav, MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { CaptainPhoneFrame } from "@/components/MarketingSections";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { groupLabelClass } from "@/components/ui/ledger";
import {
  BANNER_TITLE_CLASS,
  DISPLAY_TITLE_CLASS,
  SUB_TITLE_CLASS,
} from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import type { DiverLocale } from "@/i18n/settings";
import { switchingHref } from "@/lib/funnel";
import { earlyAccessPrice, fullShopExport, sharedLinkCard } from "@/lib/marketing";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";

// `instant = true`: navigating here paints immediately. Every request-scoped
// read sits behind a `<Suspense>` boundary — this segment's `loading.tsx`, or
// one placed inside the page — so the frame lands without waiting on the
// request. `next build` audits the claim. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Who we are — DiveDay",
  description:
    "DiveDay is built by people who dive, who saw what shops were running on and decided paperwork should not be the job. Who you are buying from, what we will not pretend, and how your records get in and back out.",
  alternates: { canonical: "/about" },
  openGraph: {
    ...sharedLinkCard,
    title: "Who we are — DiveDay",
    description:
      "Divers who saw what the shops were running on. Who you are buying from, and what we will not pretend.",
    url: "/about",
  },
  // `summary_large_image`: the OG block above names the shared link card
  // (`sharedLinkCard` → `src/app/opengraph-image.tsx`), so the large card has an
  // image to fill it — docs/product/marketing.md, Twitter-card policy.
  twitter: {
    card: "summary_large_image",
    title: "Who we are — DiveDay",
    description:
      "Divers who saw what the shops were running on. Who you are buying from, and what we will not pretend.",
  },
};

/**
 * The body renders **once**, in the reader's own language.
 *
 * Until 2026-08-14 the `<Suspense>` below took `<AboutBody
 * locale={DEFAULT_DIVER_LOCALE} />` — this whole page, a second time, in
 * English — as the fallback for the negotiated-locale one. It bought the
 * instant paint and cost the visitor everything they had done to that subtree
 * first: React carries no DOM state across a replaced subtree, so an `es-ES`
 * reader who reached the support-email or pricing doors mid-page lost the
 * interaction, and for an en-US reader the two renders were the same words, so
 * no screenshot and no English-pinned assertion could see it
 * (FU-20260812-marketing-suspense-swap-discards-interaction; the rule is ADR
 * 20260804-instant-navigation's 2026-08-14 amendment — a fallback holds shape,
 * never interaction).
 *
 * The paint is still instant, and it is this segment's `loading.tsx` that makes
 * it so; nothing in that skeleton is interactive, so there is nothing to lose
 * when the real body lands. The nav keeps its own boundary because it reads the
 * *session* as well as the locale; the body must not wait on that.
 */
export default async function AboutPage() {
  const locale = await requestLocale();
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
      <AboutBody locale={locale} />
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </div>
  );
}

/** Cached per negotiated locale (DIVER_LOCALES — two entries) — no session-scoped content. */
async function AboutBody({ locale }: { locale: DiverLocale }) {
  "use cache";
  cacheLife("max");
  const t = diverTranslator(locale);

  /**
   * The honest-no block, in the register docs/product/marketing.md asks for:
   * concede loudly, because an honest no buys trust the claims can't. These are
   * facts about the company (how new it is, how much it is still moving) rather
   * than product scope — the product's own honest-no lives on /product.
   */
  const plainTruths = [
    { title: t("marketing.about.truths.new.title"), body: t("marketing.about.truths.new.body") },
    {
      title: t("marketing.about.truths.notEverything.title"),
      body: t("marketing.about.truths.notEverything.body"),
    },
    {
      title: t("marketing.about.truths.stillMoving.title"),
      body: t("marketing.about.truths.stillMoving.body"),
    },
  ] as const;

  /**
   * Product commitments, each with the demo action that proves it. Every one is a
   * shipped behaviour a visitor can reproduce (docs/product/marketing.md,
   * shipped-only) — which is the point: a vendor with no install base earns trust
   * by being checkable, not by asserting harder.
   */
  const operatingRules = [
    {
      title: t("marketing.about.rules.survivesDock.title"),
      body: t("marketing.about.rules.survivesDock.body"),
      check: t("marketing.about.rules.survivesDock.check"),
    },
    {
      title: t("marketing.about.rules.noSilentPasses.title"),
      body: t("marketing.about.rules.noSilentPasses.body"),
      check: t("marketing.about.rules.noSilentPasses.check"),
    },
    {
      title: t("marketing.about.rules.onePrice.title"),
      body: t("marketing.about.rules.onePrice.body"),
      check: t("marketing.about.rules.onePrice.check"),
    },
    {
      title: t("marketing.about.rules.yourRecords.title"),
      body: t("marketing.about.rules.yourRecords.body"),
      check: t("marketing.about.rules.yourRecords.check"),
    },
  ] as const;

  return (
    <main className="flex-1">
      {/* The hero claims "check us", so the right column is the artifact rule 1
          sends a reader to go check: a captain's roll call, running from the
          phone's own offline copy. */}
      <section className="border-b border-border">
        <div className="mx-auto grid w-full max-w-7xl gap-12 px-6 py-16 lg:grid-cols-[1fr_0.8fr] lg:items-center lg:py-24">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              {t("marketing.about.eyebrow")}
            </p>
            <h1 className={`mt-5 ${DISPLAY_TITLE_CLASS} sm:text-5xl lg:text-6xl`}>
              {t("marketing.about.heroTitle")}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted sm:text-xl">
              {t("marketing.about.heroDescription")}
            </p>
          </div>
          <CaptainPhoneFrame
            label={t("marketing.about.phoneFrameLabel")}
            locale={locale}
            className="mx-auto w-full max-w-xs lg:max-w-sm"
          />
        </div>
      </section>

      {/* The proof comes before the concessions. This page used to open with
          two sections of prose and reach the checkable rules fourth, which put
          its only verifiable content far below the fold on every screen. */}
      <section className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-24">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold tracking-widest text-primary uppercase">
            {t("marketing.about.rulesEyebrow")}
          </p>
          <h2 className={`mt-4 ${BANNER_TITLE_CLASS} sm:text-4xl`}>
            {t("marketing.about.rulesTitle")}
          </h2>
          <p className="mt-4 text-lg leading-8 text-muted">
            {t("marketing.about.rulesDescription")}
          </p>
        </div>
        {/* `SectionCard`, so this panel is spelled the same as every other
            bordered panel in the app (one radius, one elevation) instead of a
            fifth hand-typed variant. The heading stays a call-site `h3` at the
            marketing scale rather than going through `title`: the section above
            it is `text-4xl`, and `titleAs="h3"` renders `text-base`, which
            would set the page's only checkable proof as fine print under a
            36px heading. The card's *chrome* is shared; the marketing type
            scale is not the staff one. */}
        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {operatingRules.map((rule) => (
            <SectionCard as="article" key={rule.title} padding="lg">
              <h3 className={SUB_TITLE_CLASS}>{rule.title}</h3>
              <p className="mt-3 leading-7 text-muted">{rule.body}</p>
              <p className="mt-3 text-sm leading-6 text-muted">
                <span className="font-semibold text-primary">
                  {t("marketing.common.checkItLabel")}
                </span>
                {rule.check}
              </p>
            </SectionCard>
          ))}
        </div>
        {/* The page's impulse is manufactured here and, until 2026-08-28, was
            spent two bands down on a primary-weight mailto: four cards each
            ending in "Check it: save a manifest to your phone, turn the network
            off, and run roll call anyway" — and then nothing to do it with
            until the closing band, past the founder story, the concessions and
            the export terms (docs/product/marketing-review-20260827.md, "help
            arrives after the homework"). The pair lands where the dare is made.

            No words of its own, for the reason `/product`'s index door carries
            none: the four "Check it" lines above are the caption, and a heading
            here would restate the section it closes. This is the door for a
            reader already convinced, not the page's own ask. Left-aligned on
            the section's rail, like the heading block and the grid. */}
        <FunnelCtas locale={locale} source="about-rules" className="mt-10" />
        {/* The demo's cost, stated once on this page — here, because this is
            now the first demo door a reader meets (docs/product/marketing.md,
            "The demo's cost is stated once per page, at the first door"). The
            pair above is wordless on purpose; this is not a caption for it but
            the answer to the only question its button raises, and a page that
            has just dared a burned buyer to go and check four things cannot
            leave "does this cost me my email address?" unanswered at the
            moment of the dare. The closing band repeats the door, not the
            note. */}
        <p className="mt-3 text-sm font-medium text-muted">{t("marketing.common.demoNote")}</p>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1fr] lg:items-start">
            <div>
              <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                {t("marketing.about.founderEyebrow")}
              </p>
              <h2 className={`mt-4 ${BANNER_TITLE_CLASS} sm:text-4xl`}>
                {t("marketing.about.founderTitle")}
              </h2>
            </div>
            <div className="max-w-2xl space-y-5 text-lg leading-8 text-muted">
              <p>{t("marketing.about.founderP1")}</p>
              <p>{t("marketing.about.founderP2")}</p>
              <p>{t("marketing.about.founderP3")}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-24">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold tracking-widest text-primary uppercase">
            {t("marketing.about.runEyebrow")}
          </p>
          <h2 className={`mt-4 ${BANNER_TITLE_CLASS} sm:text-4xl`}>
            {t("marketing.about.runTitle")}
          </h2>
          <p className="mt-5 text-lg leading-8 text-muted">{t("marketing.about.runP1")}</p>
          <p className="mt-4 text-lg leading-8 text-muted">{t("marketing.about.runP2")}</p>
          {/* Two peer doors for the section's two claims — write in, or read
              the price — and no primary among them. The mailto carried primary
              weight until 2026-08-28, which made "email a stranger" the
              heaviest thing a convinced reader could do on this page: a real
              offer, but a slower one than the demo, and it sat two bands below
              the proof that had convinced them. The impulse is now spent under
              the rules grid; this row stays available and stops shouting
              (docs/product/marketing-review-20260827.md, `/about`).

              The pricing door states the figure in its own words rather than
              parking it behind itself. This band raises the cost question
              three times — the "One price, no seats." rule sends a reader here
              to *check it*, the heading promises straightforward pricing, and
              the paragraph above says the whole of it is on one page — and
              until 2026-08-28 the row answered none of them: "See what it
              costs" is the unlabeled door a skeptic reads as "they won't say",
              the same card wall `/product`'s money band gave up the same day
              (docs/product/marketing-review-20260827.md, diagnosis 2). It
              costs the page no control, because the door already existed:
              the budget binds controls, not facts (docs/product/marketing.md).

              Interpolated, never spelled: `earlyAccessPrice` is H-12's single
              source, and `src/lib/marketing.test.ts` counts this key among the
              sentences that must carry `{price}` and `{cadence}`. */}
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className={buttonClass({
                variant: "secondary",
                className: "border-border-strong",
              })}
            >
              {t("marketing.about.emailCta", { email: SUPPORT_EMAIL })}
            </a>
            <Link
              href="/pricing"
              className={buttonClass({
                variant: "secondary",
                className: "border-border-strong",
              })}
            >
              {t("marketing.about.seeCost", {
                price: earlyAccessPrice.price,
                cadence: t(earlyAccessPrice.cadenceKey),
              })}
            </Link>
            <Link href="/product" className={buttonClass({ variant: "link" })}>
              {t("marketing.about.seeProduct")}
            </Link>
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-24">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              {t("marketing.about.plainlyEyebrow")}
            </p>
            <h2 className={`mt-4 ${BANNER_TITLE_CLASS} sm:text-4xl`}>
              {t("marketing.about.plainlyTitle")}
            </h2>
            <p className="mt-4 text-lg leading-8 text-muted">
              {t("marketing.about.plainlyDescription")}
            </p>
          </div>
          {/* `bg-background`, not `bg-surface`: these cards sit *on* a surface
              band, and surface-on-surface left them a border with no card.
              Which is also why these three are **not** `SectionCard` — it
              hard-codes `bg-surface` on purpose and offers no way to invert a
              card sitting on a band, and passing `bg-background` through
              `className` would be two conflicting background utilities
              resolved by stylesheet order rather than by intent. Converting
              them needs a decision in `src/components/ui/card.tsx` about what a
              card on a surface band is, not a call-site override here.

              The padding is `SectionCard`'s `lg` spelled by hand in the
              meantime, so it matches the four checkable rules above rather than
              sitting a step roomier than them. Left at `p-6 sm:p-8` these
              *concession* cards would be the most generous thing on the page
              and the page's only *proof* the tightest — inverting the hierarchy
              the section order was rearranged to get (docs/product/marketing.md,
              "concede the facts; never apologize for them"). */}
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {plainTruths.map((truth) => (
              <article
                key={truth.title}
                className="rounded-panel border border-border bg-background p-5 sm:p-6"
              >
                <h3 className={SUB_TITLE_CLASS}>{truth.title}</h3>
                <p className="mt-3 leading-7 text-muted">{truth.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-24">
        <div>
          <div className="grid gap-10 lg:grid-cols-[1fr_0.9fr] lg:items-center">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                {t("marketing.about.leaveEyebrow")}
              </p>
              <h2 className={`mt-4 ${BANNER_TITLE_CLASS} sm:text-4xl`}>
                {t("marketing.about.leaveTitle")}
              </h2>
              <p className="mt-5 text-lg leading-8 text-muted">{t("marketing.about.leaveP1")}</p>
              <p className="mt-4 text-lg leading-8 text-muted">
                {t("marketing.about.leaveP2", { terms: t(fullShopExport.termsKey) })}
              </p>
              {/* Tagged like the homepage's doors onto the same surface — this
                  is the one in-page switching door on `/about`, so it takes the
                  page's own name. The nav and footer links stay bare on
                  purpose: they render on every marketing page, so one tag
                  across all of them would answer nothing. */}
              <Link
                href={switchingHref("/switching", "about-switching")}
                className={buttonClass({ variant: "link", className: "mt-4 text-left" })}
              >
                {t("marketing.about.switchingLink")}
              </Link>
            </div>
            {/* Same `bg-background` exemption as the honest-no cards above:
                this list sits against the page and is deliberately the quieter
                surface of the two columns. `SectionCard padding="none"` is
                otherwise exactly its shape, and it converts the day the
                component grows an answer for a card that is not `bg-surface`. */}
            <dl className="divide-y divide-border rounded-panel border border-border bg-background">
              <div className="p-6">
                <dt className={groupLabelClass("primary")}>
                  {t("marketing.about.whereLiveLabel")}
                </dt>
                <dd className="mt-2 leading-7">{t("marketing.about.whereLiveValue")}</dd>
              </div>
              <div className="p-6">
                <dt className={groupLabelClass("primary")}>
                  {t("marketing.about.committingLabel")}
                </dt>
                <dd className="mt-2 leading-7">{t("marketing.about.committingValue")}</dd>
              </div>
              <div className="p-6">
                <dt className={groupLabelClass("primary")}>
                  {t("marketing.about.whoAnswersLabel")}
                </dt>
                <dd className="mt-2 leading-7">
                  {t("marketing.about.whoAnswersValue", { email: SUPPORT_EMAIL })}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 py-20 text-center lg:py-28">
        <h2 className={`mx-auto max-w-3xl ${BANNER_TITLE_CLASS} sm:text-4xl`}>
          {t("marketing.about.closingTitle")}
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted">
          {t("marketing.about.closingDescription")}
        </p>
        <FunnelCtas locale={locale} source="about-closing" className="mt-8 justify-center" />
      </section>
    </main>
  );
}
