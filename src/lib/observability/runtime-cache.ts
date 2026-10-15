import { type LogContext, log } from "@/lib/log";

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
