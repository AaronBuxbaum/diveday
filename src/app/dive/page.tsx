import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { MarketingNav, MarketingNavFallback } from "@/app/_components/MarketingNav";
import { EmptyState } from "@/components/EmptyState";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { getDb } from "@/db/client";
import { listRegions } from "@/db/regions";
import { requestTranslator } from "@/i18n/request";
import { REGIONS_PATH, regionPath } from "@/lib/region";
import { openGraphSite } from "@/lib/site-metadata";

// `instant = true`: this segment's `loading.tsx` is the boundary every
// request-scoped read below sits behind, so the frame paints without waiting
// on the request. `next build` audits the claim.
// See ADR 20260804-instant-navigation.
export const instant = true;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await requestTranslator();
  const title = t("regions.index.title");
  const description = t("regions.index.description");
  return {
    // i18n-exempt: the brand name, rendered as-is in every locale.
    title: `${title} — DiveDay`,
    description,
    alternates: { canonical: REGIONS_PATH },
    openGraph: { ...openGraphSite, title, description, url: REGIONS_PATH },
  };
}

/**
 * **The regional index** (issue #1436, N-49) — every town with at least one
 * listed shop, most shops first.
 *
 * The one page DiveDay lists shops beside each other, so the scope is the
 * narrowest public one the app has: `listedShopScope`, through `listRegions`
 * (src/db/regions.ts). A shop that said no to search is absent here for the
 * same reason it is absent from the sitemap, on the same save.
 *
 * The marketing nav carries `hideCta`: a diver looking for a boat is not the
 * trial's audience, and the page's one ask is "pick a town". The way back to
 * your own shop still shows for a signed-in staffer, because that is
 * wayfinding rather than a pitch.
 */
export default async function RegionsPage() {
  // Per request, never cached: a region exists only while a shop there has
  // something scheduled, and that turns over by the hour. `requestTranslator`
  // reads the reader's own cookie and `Accept-Language`, which is what makes
  // this render dynamic — no `connection()` is needed on top of it.
  const { t } = await requestTranslator();
  const regions = await listRegions(await getDb());

  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<MarketingNavFallback hideCta />}>
        <MarketingNav hideCta />
      </Suspense>
      {/* `px-6` at every width: the marketing chrome's gutter, so the page's
          words start where the wordmark and the footer's do (K-293). */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8 sm:py-10">
        <ShopPageHeader
          title={t("regions.index.title")}
          description={t("regions.index.description")}
        />
        {regions.length === 0 ? (
          <EmptyState title={t("regions.index.emptyTitle")} body={t("regions.index.emptyBody")} />
        ) : (
          // The ledger's geometry (`FILL_ROOM`, src/components/ui/ledger.tsx):
          // the list steps 8px out so its rules run with the row's fill, the
          // row keeps that room as its `px-2` so its words stay on the column,
          // and the fill is square, the row between two rules (K-513).
          <ul className="-mx-2 divide-y divide-border border-y border-border">
            {regions.map((region) => (
              <li key={region.slug}>
                <Link
                  href={regionPath(region.slug)}
                  className="group flex items-baseline justify-between gap-6 px-2 py-5 transition-colors hover:bg-surface-sunken focus-visible:focus-ring-inset"
                >
                  <h2 className={`${SECTION_TITLE_CLASS} min-w-0 group-hover:text-primary`}>
                    {region.name}
                  </h2>
                  <p className="shrink-0 text-sm text-muted tabular-nums">
                    {t("regions.index.shopCount", { count: region.shopCount })}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </div>
  );
}
