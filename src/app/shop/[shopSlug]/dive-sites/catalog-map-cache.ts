import { cacheLife, cacheTag } from "next/cache";
import { getDb } from "@/db/client";
import { listGlobalDiveSiteMapRows } from "@/db/dive-sites";
import { cacheStamp, reportCacheRead } from "@/lib/observability/runtime-cache";

/**
 * Vercel shares these neutral rows across users and function instances. The
 * published revision comes from the pager's existing count query: a publish
 * from a CLI, bootstrap or transaction selects a new cache entry after commit
 * without depending on a Next-only invalidation callback in the writer.
 */
async function catalogMapSnapshot(revision: string) {
  "use cache: remote";
  cacheLife("hours");
  cacheTag("dive-site-catalog-map");
  const rows = await listGlobalDiveSiteMapRows(await getDb());
  // Read revision in the body so the compiler retains it in the cache key.
  return { revision, rows, computedAtMs: cacheStamp() };
}

/** Session authorization and shop-specific presentation stay outside this cache. */
export async function cachedCatalogMapRows(revision: string) {
  const snapshot = await catalogMapSnapshot(revision);
  reportCacheRead("dive_site_catalog_map", snapshot.computedAtMs);
  return snapshot.rows;
}
