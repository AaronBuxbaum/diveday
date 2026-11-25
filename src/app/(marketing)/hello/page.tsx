import type { Metadata } from "next";
import { Suspense } from "react";
import { FounderSignature } from "@/app/_components/FounderSignature";
import { ReplyFirstCtas } from "@/app/_components/FunnelCtas";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import {
  CaptainRollCallFallback,
  FrontDeskReadinessFallback,
} from "@/components/MarketingScreenFallbacks";
import { MarketingMockup } from "@/components/MarketingSections";
import {
  BANNER_TITLE_CLASS,
  DISPLAY_TITLE_CLASS,
  LEAD_TITLE_CLASS,
} from "@/components/ui/typography";
import { planCopyParams } from "@/features/money/billing";
import { requestPricingOffer } from "@/features/money/pricing-offer";
import { FOUNDER_NAME } from "@/features/public-site/company-identity";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import type { DiverLocale } from "@/i18n/settings";
import type { PlanTerms } from "@/lib/billing/pricing-plans";
import { sharedLinkCard } from "@/lib/marketing";

// `instant = true`: this segment's `loading.tsx` paints while the locale and
// the pricing offer are read (ADR 20260804-instant-navigation).
export const instant = true;

export const metadata: Metadata = {
  title: "Try one Saturday boat on DiveDay — DiveDay",
  description:
    "Send Aaron one Saturday trip’s passenger list and he sets it up in DiveDay, so every diver signs, adds a cert card, and gives rental sizes before the boat leaves.",
  alternates: { canonical: "/hello" },
  // The page a cold email links to, so it stays out of search: the homepage is
  // the page a search should find (docs/product/marketing.md, "/hello").
  robots: { index: false, follow: true },
  openGraph: {
    ...sharedLinkCard,
    title: "Try one Saturday boat on DiveDay",
    description:
      "Send one Saturday trip’s passenger list, and every diver signs, adds a cert card, and gives rental sizes before the boat leaves.",
    url: "/hello",
  },
  twitter: {
    card: "summary_large_image",
    title: "Try one Saturday boat on DiveDay",
    description:
      "Send one Saturday trip’s passenger list, and every diver signs, adds a cert card, and gives rental sizes before the boat leaves.",
  },
};

/** The three things that happen for the one trip, in the order they happen. */
const STEP_KEYS = [
  "marketing.hello.steps.list",
  "marketing.hello.steps.link",
  "marketing.hello.steps.morning",
] as const;

/**
 * **The page the cold email links to** (2026-11-25). The email reached one
 * person about one morning, so this page continues it rather than selling the
 * product: the offer (one Saturday trip, set up by Aaron from the shop's
 * passenger list, with its booking tool left alone), the two screens no other
 * tool draws (who is ready to board and what is missing, and the head count after a
 * dive), how that trip goes, and the price. It speaks as Aaron and is signed,
 * because the email is from him.
 *
 * The asks come in the email's order: reply to the email, then the 20-minute
 * call, then the demo ({@link ReplyFirstCtas}). The hero carries the first two
 * and the signed close all three, tagged `hello` and `hello-close`.
 *
 * Not in the nav, the footer or the sitemap, and `noindex`: a visit here is a
 * tap on the email's link, which is the number this page exists to produce.
 */
export default async function HelloPage() {
  const [locale, offer] = await Promise.all([requestLocale(), requestPricingOffer()]);
  return (
    <div className="flex flex-1 flex-col">
      <HelloBody locale={locale} offer={offer} />
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </div>
  );
}

function HelloBody({ locale, offer }: { locale: DiverLocale; offer: PlanTerms }) {
  const t = diverTranslator(locale);
  return (
    <main className="flex-1">
      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-7xl px-6 py-12 lg:py-20">
          <div className="max-w-3xl">
            <p className="text-sm font-medium text-muted">{t("marketing.hello.eyebrow")}</p>
            <h1 className={`mt-3 ${DISPLAY_TITLE_CLASS} sm:text-6xl`}>
              {t("marketing.hello.heroTitle")}
            </h1>
            <p className="mt-5 text-lg leading-8 text-muted sm:text-xl">
              {t("marketing.hello.heroLede")}
            </p>
            <ReplyFirstCtas locale={locale} source="hello" className="mt-8" />
            {/* What it costs, under the doors: the owner's first question. */}
            <p className="mt-6 max-w-2xl text-sm leading-6 text-muted">
              {t("marketing.hello.price", planCopyParams(offer, locale))}
            </p>
          </div>
        </div>
      </section>

      {/* The two screens side by side from `lg`, each with its one note. */}
      <section className="mx-auto w-full max-w-7xl px-6 py-16 lg:py-24">
        <h2 className={`max-w-3xl ${BANNER_TITLE_CLASS} sm:text-4xl`}>
          {t("marketing.hello.screensTitle")}
        </h2>
        <div className="mt-10 grid gap-12 lg:grid-cols-2 lg:gap-10">
          <figure>
            <MarketingMockup label={t("marketing.hello.readyLabel")}>
              <FrontDeskReadinessFallback locale={locale} state="unsigned" />
            </MarketingMockup>
            <figcaption className="mt-5">
              <h3 className={`${LEAD_TITLE_CLASS} text-balance`}>
                {t("marketing.hello.readyTitle")}
              </h3>
              <p className="mt-2 max-w-lg leading-7 text-muted">{t("marketing.hello.readyNote")}</p>
            </figcaption>
          </figure>
          <figure>
            <MarketingMockup label={t("marketing.hello.countLabel")}>
              <CaptainRollCallFallback locale={locale} state="afterDive" />
            </MarketingMockup>
            <figcaption className="mt-5">
              <h3 className={`${LEAD_TITLE_CLASS} text-balance`}>
                {t("marketing.hello.countTitle")}
              </h3>
              <p className="mt-2 max-w-lg leading-7 text-muted">{t("marketing.hello.countNote")}</p>
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="border-t border-border bg-surface">
        <div className="mx-auto w-full max-w-7xl px-6 py-16 lg:py-24">
          <div className="max-w-3xl">
            <h2 className={`${BANNER_TITLE_CLASS} sm:text-4xl`}>
              {t("marketing.hello.stepsTitle")}
            </h2>
            <ol className="mt-8 space-y-5">
              {STEP_KEYS.map((key, index) => (
                <li key={key} className="flex gap-4">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-border bg-background text-sm font-semibold tabular-nums">
                    {index + 1}
                  </span>
                  <p className="pt-1 text-lg leading-7">{t(key)}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* The signed close: why Aaron is asking, then all three doors. */}
      <section className="border-t border-border">
        <div className="mx-auto w-full max-w-7xl px-6 py-16 lg:py-24">
          <div className="max-w-3xl">
            <p className="text-lg leading-8 sm:text-xl sm:leading-9">
              {t("marketing.hello.letter")}
            </p>
            <FounderSignature className="mt-6 h-auto w-56 text-foreground sm:w-64" />
            <p className="sr-only">{FOUNDER_NAME}</p>
            <ReplyFirstCtas locale={locale} source="hello-close" demo className="mt-8" />
          </div>
        </div>
      </section>
    </main>
  );
}
