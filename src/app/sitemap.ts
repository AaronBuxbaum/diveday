import type { MetadataRoute } from "next";
import { MIGRATION_GUIDE_SLUGS } from "@/lib/migration-guides";
import { publicAppUrl } from "@/lib/notifications";

/**
 * The public marketing surface, exactly: the pages in
 * docs/product/marketing.md plus one entry per live switching guide. Tokened
 * and staff pages are deliberately absent — adding a route here is a
 * publishing decision, not a reflex.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = publicAppUrl() ?? "http://localhost:3000";
  const entries: Array<{ path: string; priority: number }> = [
    { path: "/", priority: 1 },
    { path: "/product", priority: 0.9 },
    { path: "/pricing", priority: 0.9 },
    { path: "/onboard", priority: 0.8 },
    { path: "/switching", priority: 0.7 },
    ...MIGRATION_GUIDE_SLUGS.map((slug) => ({ path: `/switching/${slug}`, priority: 0.8 })),
  ];
  return entries.map(({ path, priority }) => ({
    url: path === "/" ? origin : `${origin}${path}`,
    priority,
  }));
}
