import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import { MarketingNav, MarketingNavFallback } from "@/app/_components/MarketingNav";
import { JsonLd } from "@/components/JsonLd";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { getDb } from "@/db/client";
import { listRegionShops } from "@/db/regions";
import { requestTranslator } from "@/i18n/request";
import { publicAppUrl } from "@/lib/notifications/app-url";
import { publicSchedulePath } from "@/lib/public-routes";
import { isRegionSlug, REGIONS_PATH, regionPath } from "@/lib/region";
import { openGraphSite } from "@/lib/site-metadata";
import { regionJsonLd } from "@/lib/structured-data";

// `instant = true`: this segment's `loading.tsx` is the boundary every
// request-scoped read below sits behind. See ADR 20260804-instant-navigation.
export const instant = true;

type RegionShop = Awaited<ReturnType<typeof listRegionShops>>[number];

/**
 * The town as the shops there spell it, or `null` when none of them names one.
 *
 * The alphabetically first spelling, which is exactly what `listRegions`'
 * `min(address_locality)` picks for the index — so the heading here and the row
 * a visitor tapped to reach it can never disagree. `null` is unreachable in
 * practice (`shops.region_slug` is derived from the locality on save, so a row
 * carrying one carries the other), and it is still a 404 rather than a heading
 * made of the slug: the index drops a nameless region for the same reason.
 */
function regionName(shops: readonly RegionShop[]): string | null {
  // Code-unit order rather than `localeCompare`: the only thing being ordered
  // is two spellings of one town, and a tie-break that depends on the reader's
  // locale could disagree with the `min()` the index already picked.
  const names = shops
    .map((shop) => shop.addressLocality)
    .filter((locality): locality is string => Boolean(locality))
    .sort();
  return names[0] ?? null;
}

/**
 * The shops on this page, or `notFound()`.
 *
 * A `[region]` that is not a slug this app could have produced never reaches
 * the database — the shape test comes first, and the value is only ever spent
 * on an equality match. A valid slug with no listed shops refuses the same
 * way: a town DiveDay cannot serve gets the not-found page rather than a
 * heading over nothing.
 *
 * **What that refusal is worth, measured rather than assumed.** Under this
 * app's `cacheComponents` setup a `notFound()` thrown from a dynamic page body
 * answers **200** with the not-found page in the streamed payload — the status
 * line is gone by the time the body runs. Probed 2026-09-07 against a
 * production build: `/s/<unknown-shop>` and `/s/blue-mantis/courses/<unknown>`
 * answered 200 the same way, so this route was consistent with every other
 * dynamic page here rather than uniquely wrong.
 *
 * **That stopped being true of `/s/**`, and it is still true here.** The public
 * shop namespace now decides the status above the streaming boundary, in
 * `src/proxy.ts` (ADR 20260912-the-public-namespace-refuses-at-the-edge), so
 * its unknown URLs answer a real 404 and this route is no longer consistent
 * with them. It was left out of that change because it asks a different
 * question — a region slug is a closed list this repository holds, not a row —
 * so it is still a soft 404 to a crawler, on a page DiveDay does want indexed.
 * Issue #1734 carries it, together with `/switching/[competitor]` and
 * `/demo/[story]`, which are soft for the same reason. Until it lands, no
 * comment here should read as if the status were 404.
 */
const regionShops = cache(async (region: string) => {
  if (!isRegionSlug(region)) notFound();
  const shops = await listRegionShops(await getDb(), region);
  const name = regionName(shops);
  if (shops.length === 0 || name === null) notFound();
  return { shops, name };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ region: string }>;
}): Promise<Metadata> {
  const { region } = await params;
  const { name } = await regionShops(region);
  const { t } = await requestTranslator();
  const title = t("regions.region.title", { name });
  const description = t("regions.region.description");
  const canonical = regionPath(region);
  return {
    // i18n-exempt: the brand name, rendered as-is in every locale.
    title: `${title} — DiveDay`,
    description,
    alternates: { canonical },
    openGraph: { ...openGraphSite, title, description, url: canonical },
  };
}

/**
 * **One town's dive shops** (issue #1436, N-49) — the listed shops there, by
 * name, each linking to its own storefront.
 *
 * Every card carries only what that shop's own `/s/<slug>` already shows an
 * anonymous visitor and the shop itself authored: its logo, its name, its
 * tagline. Nothing is invented for the shop that has written none of it — a
 * day-zero row is a shorter card, not an apologetic one, which is the rule
 * `ShopfrontHero` keeps on the storefront itself.
 *
 * **No departures.** `listRegionShops` is unbounded and
 * `publicAvailabilityTrips` is three queries per shop, so showing "next out"
 * on every card would fan a busy town out to 3N reads on an anonymous,
 * crawler-visible page. The storefront one tap away answers it properly.
 */
export default async function RegionPage({ params }: { params: Promise<{ region: string }> }) {
  const { region } = await params;
  // The town before the words: the refusal is about the URL, and resolving it
  // first keeps the reader's language out of a decision that does not depend
  // on it.
  const { shops, name } = await regionShops(region);
  const { t } = await requestTranslator();
  const title = t("regions.region.title", { name });
  const graph = regionJsonLd(title, shops, publicAppUrl());

  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<MarketingNavFallback hideCta />}>
        <MarketingNav hideCta />
      </Suspense>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {graph ? <JsonLd data={graph} /> : null}
        <ShopPageHeader
          eyebrow={t("regions.index.title")}
          eyebrowHref={REGIONS_PATH}
          title={title}
          description={t("regions.region.description")}
        />
        <ul className="divide-y divide-border border-y border-border">
          {shops.map((shop) => (
            <li key={shop.id}>
              <Link
                href={publicSchedulePath(shop.slug)}
                className="group -mx-3 flex items-center gap-4 rounded-lg px-3 py-5 transition-colors hover:bg-surface-sunken"
              >
                {shop.logoUrl ? (
                  // biome-ignore lint/performance/noImgElement: dynamic user-uploaded logo
                  <img
                    src={shop.logoUrl}
                    alt=""
                    className="size-14 shrink-0 rounded-inset border border-border bg-surface object-cover"
                  />
                ) : null}
                <div className="min-w-0">
                  <h2 className={`${SECTION_TITLE_CLASS} group-hover:text-primary`}>{shop.name}</h2>
                  {shop.tagline ? (
                    <p className="mt-1 max-w-xl text-sm text-muted">{shop.tagline}</p>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </div>
  );
}
