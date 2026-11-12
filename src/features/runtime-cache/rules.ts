import { type LogContext, log } from "../../lib/log";

/**
 * **Did a `"use cache"` entry get reused? One log line says** (code review
 * 2026-10-13b, item 19; docs/architecture/performance-budgets.md, "Runtime
 * caches").
 *
 * Next's default cache handler is an in-memory LRU per server instance, and its
 * own docs say that on serverless "cache entries typically don't persist
 * across requests". Whether that holds for a given cache on this deployment
 * is a measurement, not a reading of the docs, so a cached scope stamps the
 * moment it computed its value (`cacheStamp()`, inside the cached function)
 * and the caller reports how old the value it got back is
 * (`reportCacheRead`). A value computed during this render is a miss; an
 * older one was served from the cache.
 *
 * Wall time from `performance`, not the app clock: the e2e harness freezes
 * `nowMs()`, and a frozen clock would read every hit as a miss. Nothing here
 * decides behaviour, so the frozen instant is not needed.
 */

type GenerationGlobal = typeof globalThis & { __divedayShopRowsCacheGeneration?: number };

/**
 * **Which generation of a shop's rows a `"use cache"` scope was computed
 * from**, passed as one of its arguments so it is part of the key. Always 0 in
 * a deployment: an entry there turns over on its `cacheLife`. The e2e routes
 * that rewrite a shop's rows (`/api/test/reset`, `/api/test/shop`) call
 * `expireShopRowsCaches()`, so a test reads the rows it seeded rather than an
 * entry an earlier test's view cached. Held on `globalThis`, like the e2e
 * routes' own state, so the route bundles and the page bundles see one value.
 */
export function shopRowsCacheGeneration(): number {
  return (globalThis as GenerationGlobal).__divedayShopRowsCacheGeneration ?? 0;
}

/** Start a new generation: every entry keyed on the old one is never read again. */
export function expireShopRowsCaches(): void {
  const shared = globalThis as GenerationGlobal;
  shared.__divedayShopRowsCacheGeneration = shopRowsCacheGeneration() + 1;
}

/** A value younger than this was computed during the render that reads it. */
const SAME_RENDER_MS = 2_000;

/** The wall-clock moment a cached scope computed its value. Call it inside the cached function. */
export function cacheStamp(): number {
  return Math.round(performance.timeOrigin + performance.now());
}

export function cacheReadOutcome(
  computedAtMs: number,
  readAtMs: number,
): { outcome: "hit" | "miss"; ageS: number } {
  const ageMs = Math.max(0, readAtMs - computedAtMs);
  return {
    outcome: ageMs < SAME_RENDER_MS ? "miss" : "hit",
    ageS: ageMs < SAME_RENDER_MS ? 0 : Math.round(ageMs / 1000),
  };
}

/**
 * One `cache.read` line: which cache, hit or miss, and the entry's age in
 * seconds. `context` is ids only, as every log line's is.
 */
export function reportCacheRead(
  cache: string,
  computedAtMs: number,
  context: LogContext = {},
  readAtMs: number = cacheStamp(),
): void {
  log("cache.read", "info", { cache, ...cacheReadOutcome(computedAtMs, readAtMs), ...context });
}
