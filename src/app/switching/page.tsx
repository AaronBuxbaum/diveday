import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { FunnelCtas } from "@/app/_components/FunnelCtas";
import { MarketingNav, MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { ImportPreviewFallback } from "@/components/MarketingScreenFallbacks";
import { MarketingMockup } from "@/components/MarketingSections";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { SwitchingConcierge } from "@/components/SwitchingConcierge";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE, type DiverLocale } from "@/i18n/settings";
import { cachedListFormat } from "@/lib/intl-cache";
import { sharedLinkCard } from "@/lib/marketing";
import { MIGRATION_GUIDES } from "@/lib/migration-guides";

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
  description: `On a spreadsheet, or leaving ${metadataCompetitors}? Step-by-step guides to bring your divers, cards, and sizes into DiveDay — with a clear picture of what comes across.`,
  alternates: { canonical: "/switching" },
  openGraph: {
    ...sharedLinkCard,
    title: "Switching guides — DiveDay",
    description:
      "Step-by-step guides to bring your divers, cards, and sizes into DiveDay — with a clear picture of what comes across.",
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
      "Step-by-step guides to bring your divers, cards, and sizes into DiveDay — with a clear picture of what comes across.",
  },
};

export default function SwitchHubPage() {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
      {/* The body renders **once**, in the reader's own language, behind a
          skeleton — never twice, with an English copy of itself standing in for
          the localized one. That older arrangement bought the instant paint by
          passing the whole body as its own fallback, and the swap that followed
          tore the subtree down and rebuilt it, discarding whatever the visitor
          had already done to it. For an en-US reader both renders are the same
          words, so it was invisible in every screenshot and every
          English-pinned assertion; for an `es-ES` reader it threw away a tap on
          one of the guide rows below, which are this page's whole content
          (FU-20260812-marketing-suspense-swap-discards-interaction, ADR
          20260804-instant-navigation's 2026-08-14 amendment — a fallback holds
          shape, never interaction). A skeleton has nothing to tap, so there is
          nothing to lose; keep it that way. */}
      <Suspense fallback={<SwitchHubBodySkeleton />}>
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
 * What the static shell paints while {@link LocalizedSwitchHubBody} resolves.
 *
 * It lives inside the page rather than in a `src/app/switching/loading.tsx`,
 * which is the arrangement ADR 20260804-instant-navigation otherwise asks for:
 * `loading.tsx` is the boundary for a segment **and everything under it**, and
 * `/switching` has children — `/switching/[competitor]`, whose hero-and-rail
 * body looks nothing like this index of links. `/switching/spreadsheet` carries
 * its own, so a file here would only ever mis-shape the competitor guides. Same
 * reasoning as `src/app/page.tsx`, for the same structural reason.
 *
 * Shaped like the hero and the index rows beneath it — one row per guide, off
 * the same registry the list itself is built from, so the two cannot drift —
 * and nothing in it is a link, a button, or a form. That is the fix, not an
 * economy.
 */
function SwitchHubBodySkeleton() {
  return (
    <main className="flex-1 animate-pulse">
      <section className="mx-auto max-w-4xl px-6 pt-16 pb-10 lg:pt-24 lg:pb-14">
        <div className="h-4 w-44 rounded bg-surface-sunken" />
        <div className="mt-5 h-11 w-full max-w-xl rounded bg-surface-sunken sm:h-12" />
        <div className="mt-3 h-11 w-2/3 max-w-md rounded bg-surface-sunken sm:h-12" />
        <div className="mt-6 h-5 w-full max-w-2xl rounded bg-surface-sunken" />
        <div className="mt-2 h-5 w-3/4 max-w-xl rounded bg-surface-sunken" />
      </section>

      {/* The index: the spreadsheet row, then one per incumbent guide. */}
      <section className="mx-auto max-w-4xl px-6 pb-16 lg:pb-24">
        <ul className="border-t border-border">
          {["spreadsheet", ...MIGRATION_GUIDES.map((guide) => guide.slug)].map((slug) => (
            <li key={slug} className="border-b border-border py-6">
              <div className="h-6 w-full max-w-xs rounded bg-surface-sunken" />
              <div className="mt-3 h-5 w-full max-w-lg rounded bg-surface-sunken" />
            </li>
          ))}
        </ul>
        {/* The "something else, or nothing at all" row that closes the list. */}
        <div className="border-b border-border py-8">
          <div className="h-6 w-full max-w-xs rounded bg-surface-sunken" />
          <div className="mt-3 h-5 w-full max-w-lg rounded bg-surface-sunken" />
        </div>
      </section>
    </main>
  );
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
                className="group flex items-start gap-6 border-b border-border py-6 transition-colors hover:bg-surface"
              >
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-semibold tracking-tight group-hover:text-primary">
                    {guide.title}
                  </h2>
                  <p className="mt-1.5 leading-7 text-muted">{guide.summary}</p>
                </div>
                <DiveDayIcon
                  name="arrow-right"
                  className="mt-1 size-5 shrink-0 text-muted transition-transform group-hover:translate-x-1 group-hover:text-primary motion-reduce:transition-none"
                />
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
            <FunnelCtas locale={locale} source="switching-hub" />
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
