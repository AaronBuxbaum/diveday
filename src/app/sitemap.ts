"use cache";

import type { MetadataRoute } from "next";
import { cacheLife } from "next/cache";
import { getDb } from "@/db/client";
import { listActiveCoursesForSitemap } from "@/db/courses";
import { listDiveSitesForSitemap } from "@/db/dive-sites";
import { listRegions } from "@/db/regions";
import { listShopsForSitemap } from "@/db/shops";
import { MIGRATION_GUIDE_SLUGS } from "@/lib/migration-guides";
import { publicAppUrl } from "@/lib/notifications";
import { publicCoursePath, publicDiveSitePath, publicSchedulePath } from "@/lib/public-routes";
import { REGIONS_PATH, regionPath } from "@/lib/region";

/**
 * The public marketing surface (the pages in docs/product/marketing.md plus
 * one entry per live switching guide), plus every shop's public schedule,
 * active course pages and dive-site pages — all of which carry canonicals and
 * JSON-LD (docs ADR
 * 20260729-booking-page-structured-data) and are indexable by design. Demo
 * shops (including the `blue-mantis` e2e/visual fixture) are excluded at the
 * query layer (`listShopsForSitemap`, `listActiveCoursesForSitemap`) — a demo
 * is a test fixture, not a real shop. Tokened and staff pages are
 * deliberately absent throughout. A genuinely new *kind* of route (not one of
 * these two shapes) is still a publishing decision, not a reflex — add it
 * deliberately rather than by copying this pattern blindly.
 *
 * No `lastModified` is set: there is no cheap, honest "last updated" signal
 * for a shop or course readily available without an extra query, and
 * fabricating one would be worse than omitting it.
 *
 * This route has no request-time API (no `headers()`, no session), so it's
 * eligible for `"use cache"` in full — a shop that signs up between deploys
 * would otherwise stay out of the sitemap until the next one ships, so
 * `cacheLife("hours")` puts a ceiling on that staleness instead (matches the
 * previous `revalidate = 3600`, pre-cacheComponents).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  cacheLife("hours");
  const origin = publicAppUrl() ?? "http://localhost:3000";
  const entries: Array<{ path: string; priority: number }> = [
    { path: "/", priority: 1 },
    { path: "/product", priority: 0.9 },
    { path: "/pricing", priority: 0.9 },
    { path: "/onboard", priority: 0.8 },
    { path: "/about", priority: 0.6 },
    // The regional index (issue #1436, N-49). Its town pages are appended
    // below, from the same reader the page itself uses, so a town appears here
    // exactly while it has a listed shop to show.
    { path: REGIONS_PATH, priority: 0.6 },
    { path: "/switching", priority: 0.7 },
    { path: "/switching/spreadsheet", priority: 0.8 },
    ...MIGRATION_GUIDE_SLUGS.map((slug) => ({ path: `/switching/${slug}`, priority: 0.8 })),
  ];

  const db = await getDb();
  const [shopRows, courseRows, siteRows, regionRows] = await Promise.all([
    listShopsForSitemap(db),
    listActiveCoursesForSitemap(db),
    listDiveSitesForSitemap(db),
    listRegions(db),
  ]);
  for (const region of regionRows) {
    entries.push({ path: regionPath(region.slug), priority: 0.6 });
  }
  for (const shop of shopRows) {
    entries.push({ path: publicSchedulePath(shop.slug), priority: 0.7 });
  }
  for (const course of courseRows) {
    entries.push({
      path: publicCoursePath(course.shopSlug, course.courseSlug),
      priority: 0.6,
    });
  }
  // The place pages (N-48). Below a course, which is something the shop sells,
  // and above nothing: a reef page is the entry a diver searching for the reef
  // rather than the shop arrives on.
  for (const site of siteRows) {
    entries.push({
      path: publicDiveSitePath(site.shopSlug, site.siteSlug),
      priority: 0.5,
    });
  }

  return entries.map(({ path, priority }) => ({
    url: path === "/" ? origin : `${origin}${path}`,
    priority,
  }));
}
