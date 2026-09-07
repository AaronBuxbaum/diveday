import { and, asc, count, desc, eq, isNotNull, min } from "drizzle-orm";
import type { AppDb } from "./client";
import { shops } from "./schema";
import { listedShopScope } from "./shops";

/**
 * **The regional pages' two reads** (issue #1436, improvement-ideas N-49).
 *
 * `/dive` and `/dive/<region>` are the one place DiveDay lists shops beside
 * each other, so the scope is the narrowest public one the app already has:
 * `listedShopScope` — not a demo, not opted out of search, at least one
 * scheduled departure — plus a region. A shop that is not in the sitemap is
 * not on a regional page, and a shop that opts out of search leaves both on
 * the same save (ADR 20260813-search-listing-is-a-choice; the setting's copy
 * says so).
 *
 * **Public facts only.** These readers return shop rows, which the pages
 * then read for the same fields the shop's own storefront already shows an
 * anonymous visitor; the departures come from `publicAvailabilityTrips`
 * (`src/db/availability.ts`), the reader built for a stranger. Nothing here
 * joins a booking, a person or a staff table, and nothing here is reached
 * from a staff surface.
 */

export type RegionSummary = {
  slug: string;
  /** The locality as the shops there typed it — the alphabetically first spelling when they differ. */
  name: string;
  shopCount: number;
};

/** Every region with at least one listed shop, most shops first, then by name. */
export async function listRegions(db: AppDb): Promise<RegionSummary[]> {
  const rows = await db
    .select({
      slug: shops.regionSlug,
      name: min(shops.addressLocality),
      shopCount: count(shops.id),
    })
    .from(shops)
    .where(and(listedShopScope(db), isNotNull(shops.regionSlug)))
    .groupBy(shops.regionSlug)
    .orderBy(desc(count(shops.id)), asc(min(shops.addressLocality)));
  return rows.flatMap((row) =>
    row.slug && row.name ? [{ slug: row.slug, name: row.name, shopCount: row.shopCount }] : [],
  );
}

/** The listed shops in one region, by name. Empty for a region nobody listed is in. */
export async function listRegionShops(db: AppDb, regionSlug: string) {
  return db
    .select()
    .from(shops)
    .where(and(listedShopScope(db), eq(shops.regionSlug, regionSlug)))
    .orderBy(asc(shops.name), asc(shops.id));
}
