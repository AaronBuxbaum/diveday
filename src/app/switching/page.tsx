import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { MarketingNav, MarketingNavFallback } from "@/components/MarketingNav";
import { ImportPreviewFallback } from "@/components/MarketingScreenFallbacks";
import { MarketingMockup } from "@/components/MarketingSections";
import { SwitchingConcierge } from "@/components/SwitchingConcierge";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE, type DiverLocale } from "@/i18n/settings";
import { cachedListFormat } from "@/lib/intl-cache";
import { sharedLinkCard } from "@/lib/marketing";
import { MIGRATION_GUIDES } from "@/lib/migration-guides";
import { DemoTrialCtas } from "./_components/guide";

// `instant = true`: navigating here paints immediately. Every request-scoped
// read sits behind a `<Suspense>` boundary — this segment's `loading.tsx`, or
// one placed inside the page — so the frame lands without waiting on the
// request. `next build` audits the claim. See ADR 20260804-instant-navigation.
export const instant = true;

// Generated from the migration-guides registry, never hand-listed, so a new
// guide can't be silently omitted from this page's own metadata. `metadata`
// is a static export (no `generateMetadata` here), so this stays fixed to the
// default locale — consistent with the rest of this file's un-negotiated
// metadata, and the reason this reaches for the named constant rather than a
// literal (pnpm check:locale bans the literal outright).
const metadataCompetitors = cachedListFormat(DEFAULT_DIVER_LOCALE, {
  type: "disjunction",
}).format(MIGRATION_GUIDES.map((guide) => guide.competitor));

export const metadata: Metadata = {
  title: "Switching guides — DiveDay",
  description: `On a spreadsheet, or leaving ${metadataCompetitors}? Step-by-step guides to bring your divers, cards, and sizes into DiveDay — with an honest account of what comes across.`,
  alternates: { canonical: "/switching" },
  openGraph: {
    ...sharedLinkCard,
    title: "Switching guides — DiveDay",
    description:
      "Step-by-step guides to bring your divers, cards, and sizes into DiveDay — with an honest account of what comes across.",
    url: "/switching",
  },
  // `summary_large_image`: the OG block above names the shared link card
  // (`sharedLinkCard` → `src/app/opengraph-image.tsx`), so the large card has an
  // image to fill it — docs/product/marketing.md, Twitter-card policy. These
  // pages get pasted into shop owners' chat groups more than any other, which
  // is the whole reason the card block is not optional here.
  twitter: {
    card: "summary_large_image",
    title: "Switching guides — DiveDay",
    description:
      "Step-by-step guides to bring your divers, cards, and sizes into DiveDay — with an honest account of what comes across.",
  },
};

export default function SwitchHubPage() {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
      <Suspense fallback={<SwitchHubBody locale={DEFAULT_DIVER_LOCALE} />}>
        <LocalizedSwitchHubBody />
      </Suspense>
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </div>
  );
}

async function LocalizedSwitchHubBody() {
  const locale = await requestLocale();
  return <SwitchHubBody locale={locale} />;
}

/**
 * Cached per negotiated locale (DIVER_LOCALES — two entries) — no
 * session-scoped content.
 *
 * The hub has exactly one job: **help a shop owner recognize themselves.** So
 * the page is a list of names, not a gallery. It used to be six bordered
 * cards in a two-column grid, each ending in its own "Read the guide →" — the
 * same fact printed six times at equal weight (principles.md #9), in a shape
 * that reads as a brochure rather than an index. It is now one hairline-ruled
 * list whose rows are the links themselves (#10, actions ride on their
 * objects), which also lets the list end in the row a reader who found nothing
 * needs: "something else, or nothing at all", with the demo and trial right
 * there. That row absorbed the whole closing CTA band, so the page is four
 * sections instead of five and the escape hatch sits where the search failed
 * rather than two screens below it.
 */
async function SwitchHubBody({ locale }: { locale: DiverLocale }) {
  "use cache";
  cacheLife("max");
  const t = diverTranslator(locale);
  const guides = [
    {
      href: "/switching/spreadsheet",
      title: t("switching.hub.spreadsheetTitle"),
      summary: t("switching.hub.spreadsheetDescription"),
    },
    ...MIGRATION_GUIDES.map((guide) => ({
      href: `/switching/${guide.slug}`,
      title: t("switching.hub.switchingFrom", { competitor: guide.competitor }),
      summary: t(guide.cardSummary),
    })),
  ];
  return (
    <main className="flex-1">
      <section className="mx-auto max-w-4xl px-6 pt-16 pb-10 lg:pt-24 lg:pb-14">
        <p className="text-sm font-semibold tracking-widest text-primary uppercase">
          {t("switching.hub.eyebrow")}
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] text-balance sm:text-5xl">
          {t("switching.hub.title")}
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
          {t("switching.hub.description")}
        </p>
      </section>

      {/* The index. Whole-row links: the name is what a reader scans for, the
          summary is why they'd stop, and the arrow is the only chrome. */}
      <section className="mx-auto max-w-4xl px-6 pb-16 lg:pb-24">
        <ul className="border-t border-border">
          {guides.map((guide) => (
            <li key={guide.href}>
              <Link
                href={guide.href}
                className="group flex items-start gap-6 border-b border-border py-6 transition-colors duration-200 hover:bg-surface"
              >
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-semibold tracking-tight group-hover:text-primary">
                    {guide.title}
                  </h2>
                  <p className="mt-1.5 leading-7 text-muted">{guide.summary}</p>
                </div>
                <span
                  aria-hidden
                  className="mt-1 shrink-0 text-lg text-muted transition-transform duration-200 group-hover:translate-x-1 group-hover:text-primary motion-reduce:transition-none"
                >
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>

        {/* The last row of the same list, for the reader who found nothing in
            it — the closing CTA band, moved to where the question is asked. */}
        <div className="flex flex-col gap-6 border-b border-border py-8 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              {t("switching.hub.dontSeeSystem")}
            </h2>
            <p className="mt-1.5 max-w-xl leading-7 text-muted">
              {t("switching.hub.dontSeeSystemBody")}
            </p>
          </div>
          <div className="lg:shrink-0">
            <DemoTrialCtas locale={locale} source="switching-hub" />
          </div>
        </div>
      </section>

      {/* "Exactly what comes across" is this page's whole promise, and it used
          to be made only in prose. This is the importer's real preview step in
          miniature — mapped columns, the ignored ones named, the skipped row
          visible — so the promise is shown before it is described.
          Stacked inside the page's own `max-w-4xl` measure rather than beside
          the words at `max-w-7xl`: the wide band started 130px left of every
          other section on the page, and stacking gives the mockup ~200px more
          width than the two-column version it replaced. */}
      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-4xl px-6 py-16 lg:py-20">
          <p className="text-sm font-semibold tracking-widest text-primary uppercase">
            {t("switching.hub.previewEyebrow")}
          </p>
          <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
            {t("switching.hub.previewTitle")}
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
            {t("switching.hub.previewBody")}
          </p>
          <MarketingMockup
            label={t("switching.hub.previewMockupLabel")}
            className="mt-10 shadow-xl shadow-foreground/5"
          >
            <ImportPreviewFallback locale={locale} />
          </MarketingMockup>
        </div>
      </section>

      {/* The owner-authorized concierge switch offer (shared across /switching). */}
      <SwitchingConcierge locale={locale} />
    </main>
  );
}
