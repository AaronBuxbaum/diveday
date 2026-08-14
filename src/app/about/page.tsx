import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { MarketingNav, MarketingNavFallback } from "@/components/MarketingNav";
import { CaptainPhoneFrame } from "@/components/MarketingSections";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import type { DiverLocale } from "@/i18n/settings";
import { trialHref } from "@/lib/funnel";
import { fullShopExport, sharedLinkCard } from "@/lib/marketing";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";

// `instant = true`: navigating here paints immediately. Every request-scoped
// read sits behind a `<Suspense>` boundary — this segment's `loading.tsx`, or
// one placed inside the page — so the frame lands without waiting on the
// request. `next build` audits the claim. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Who we are — DiveDay",
  description:
    "DiveDay is built by people who dive, who saw what shops were actually running on and decided paperwork shouldn't be the job. Who you're buying from, what we won't pretend, and how your records get in — and back out.",
  alternates: { canonical: "/about" },
  openGraph: {
    ...sharedLinkCard,
    title: "Who we are — DiveDay",
    description:
      "Divers who saw what the shops were running on. Who you're buying from, and what we won't pretend.",
    url: "/about",
  },
  // `summary_large_image`: the OG block above names the shared link card
  // (`sharedLinkCard` → `src/app/opengraph-image.tsx`), so the large card has an
  // image to fill it — docs/product/marketing.md, Twitter-card policy.
  twitter: {
    card: "summary_large_image",
    title: "Who we are — DiveDay",
    description:
      "Divers who saw what the shops were running on. Who you're buying from, and what we won't pretend.",
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
            <h1 className="mt-5 text-4xl font-semibold tracking-[-0.045em] text-balance sm:text-5xl lg:text-6xl">
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
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
            {t("marketing.about.rulesTitle")}
          </h2>
          <p className="mt-4 text-lg leading-8 text-muted">
            {t("marketing.about.rulesDescription")}
          </p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {operatingRules.map((rule) => (
            <article
              key={rule.title}
              className="rounded-2xl border border-border bg-surface p-6 sm:p-8"
            >
              <h3 className="text-xl font-semibold tracking-tight">{rule.title}</h3>
              <p className="mt-3 leading-7 text-muted">{rule.body}</p>
              <p className="mt-3 text-sm leading-6 text-muted">
                <span className="font-semibold text-primary">
                  {t("marketing.common.checkItLabel")}
                </span>
                {rule.check}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1fr] lg:items-start">
            <div>
              <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                {t("marketing.about.founderEyebrow")}
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
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
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
            {t("marketing.about.runTitle")}
          </h2>
          <p className="mt-5 text-lg leading-8 text-muted">{t("marketing.about.runP1")}</p>
          <p className="mt-4 text-lg leading-8 text-muted">{t("marketing.about.runP2")}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className={buttonClass({ className: "cursor-pointer" })}
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
              {t("marketing.about.seeCost")}
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
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
              {t("marketing.about.plainlyTitle")}
            </h2>
            <p className="mt-4 text-lg leading-8 text-muted">
              {t("marketing.about.plainlyDescription")}
            </p>
          </div>
          {/* `bg-background`, not `bg-surface`: these cards sit *on* a surface
              band, and surface-on-surface left them a border with no card. */}
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {plainTruths.map((truth) => (
              <article
                key={truth.title}
                className="rounded-2xl border border-border bg-background p-6 sm:p-8"
              >
                <h3 className="text-xl font-semibold tracking-tight">{truth.title}</h3>
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
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
                {t("marketing.about.leaveTitle")}
              </h2>
              <p className="mt-5 text-lg leading-8 text-muted">{t("marketing.about.leaveP1")}</p>
              <p className="mt-4 text-lg leading-8 text-muted">
                {t("marketing.about.leaveP2", { terms: t(fullShopExport.termsKey) })}
              </p>
              <Link
                href="/switching"
                className={buttonClass({ variant: "link", className: "mt-4 text-left" })}
              >
                {t("marketing.about.switchingLink")}
              </Link>
            </div>
            <dl className="divide-y divide-border rounded-2xl border border-border bg-background">
              <div className="p-6">
                <dt className="text-xs font-semibold tracking-widest text-primary uppercase">
                  {t("marketing.about.whereLiveLabel")}
                </dt>
                <dd className="mt-2 leading-7">{t("marketing.about.whereLiveValue")}</dd>
              </div>
              <div className="p-6">
                <dt className="text-xs font-semibold tracking-widest text-primary uppercase">
                  {t("marketing.about.committingLabel")}
                </dt>
                <dd className="mt-2 leading-7">{t("marketing.about.committingValue")}</dd>
              </div>
              <div className="p-6">
                <dt className="text-xs font-semibold tracking-widest text-primary uppercase">
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
        <h2 className="mx-auto max-w-3xl text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
          {t("marketing.about.closingTitle")}
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted">
          {t("marketing.about.closingDescription")}
        </p>
        <div className="mt-8 flex flex-col items-center gap-3">
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <form action={enterDemoAction}>
              <FunnelTag source="about-closing" />
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
              href={trialHref("about-closing")}
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
