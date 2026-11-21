import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { Suspense } from "react";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { SwitchingConcierge } from "@/components/SwitchingConcierge";
import { LEAD_TITLE_CLASS } from "@/components/ui/typography";
import { requestPricingOffer } from "@/features/money/pricing-offer";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import type { DiverLocale } from "@/i18n/settings";
import type { PlanTerms } from "@/lib/billing/pricing-plans";
import { sharedLinkCard } from "@/lib/marketing";
import {
  ClosingCta,
  DividedList,
  GUIDE_BAND_CLASS,
  GuideContext,
  GuideHero,
} from "../_components/guide";

// `instant = true`: see the sibling guides and ADR 20260804-instant-navigation.
export const instant = true;

/**
 * "Alongside your tools": how a shop runs DiveDay beside the software it
 * already has. Not an incumbent guide (no vendor, no export click-path, no
 * `sources`) and not a way out: it is the page for the owner who would rather
 * try one departure than commit to a move.
 *
 * Every line states what the product does today and no more. There is no live
 * sync with a booking site, no agency account (the browser extension checks one card at a time), no retail register, and card
 * payments run through the shop's own Stripe account; the keep-it answers come
 * from the pricing FAQ and the FareHarbor and EVE guides, the import lines from
 * `IMPORT_HONESTY_TABLE`. Never add an integration here that the demo cannot show.
 */

const TITLE = "Keep your tools, add DiveDay — DiveDay";
const DESCRIPTION =
  "Run one departure in DiveDay while your booking site, register and spreadsheet keep doing their jobs. What DiveDay connects to, what it doesn’t, and how to decide what to move.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/switching/alongside" },
  openGraph: {
    ...sharedLinkCard,
    title: TITLE,
    description: DESCRIPTION,
    url: "/switching/alongside",
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const TOOLS = ["booking", "register", "sheet", "waivers", "agency", "website"] as const;
const WEEK = ["one", "two", "three"] as const;

export default async function AlongsideSwitchPage() {
  const [locale, offer] = await Promise.all([requestLocale(), requestPricingOffer()]);
  return (
    <div className="flex flex-1 flex-col">
      <AlongsideBody locale={locale} offer={offer} />
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </div>
  );
}

/** Cached per negotiated locale (two entries); nothing here is per visitor. */
async function AlongsideBody({ locale, offer }: { locale: DiverLocale; offer: PlanTerms }) {
  "use cache";
  cacheLife("max");
  const t = diverTranslator(locale);
  return (
    <main className="flex-1">
      <GuideHero
        locale={locale}
        source="switching-alongside"
        offer={offer}
        eyebrow={t("switching.alongside.eyebrow")}
        title={t("switching.alongside.title")}
        lede={t("switching.alongside.heroLede")}
      />

      <GuideContext
        locale={locale}
        paragraphs={[t("switching.alongside.intro1"), t("switching.alongside.intro2")]}
      >
        <DividedList
          items={TOOLS.map((tool) => ({
            title: t(`switching.alongside.tools.${tool}.title`),
            detail: t(`switching.alongside.tools.${tool}.body`),
          }))}
        />
      </GuideContext>

      <section className="border-b border-border">
        <div className={GUIDE_BAND_CLASS}>
          <h2 className={`${LEAD_TITLE_CLASS} text-balance`}>
            {t("switching.alongside.weekTitle")}
          </h2>
          <DividedList
            items={WEEK.map((step) => ({
              title: t(`switching.alongside.week.${step}.title`),
              detail: t(`switching.alongside.week.${step}.body`),
            }))}
          />
        </div>
      </section>

      <SwitchingConcierge locale={locale} source="switching-alongside-concierge" />

      <ClosingCta
        locale={locale}
        source="switching-alongside-close"
        title={t("switching.alongside.closingTitle")}
        body={t("switching.alongside.closingDescription")}
        backLabel={t("switching.common.backToGuides")}
      />
    </main>
  );
}
