import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cacheReadOutcome,
  expireShopRowsCaches,
  reportCacheRead,
  shopRowsCacheGeneration,
} from "./rules";

/**
 * **Whether a `"use cache"` entry was reused, told from outside the cache**
 * (code review 2026-10-13b, item 19). The first cache under `/s` runs on the
 * default in-memory handler, which on serverless "typically" does not persist
 * across requests; this is the line that says whether it did.
 */
describe("cacheReadOutcome", () => {
  it("reads an entry computed during this render as a miss", () => {
    expect(cacheReadOutcome(10_000, 10_400)).toEqual({ outcome: "miss", ageS: 0 });
  });

  it("reads an entry computed before this render as a hit, with its age", () => {
    expect(cacheReadOutcome(10_000, 10_000 + 1_800_000)).toEqual({ outcome: "hit", ageS: 1800 });
  });

  it("calls an entry from just past the window a hit rather than guess", () => {
    expect(cacheReadOutcome(0, 2_000)).toEqual({ outcome: "hit", ageS: 2 });
  });
});

describe("reportCacheRead", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes one structured line naming the cache, the outcome and the age", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      lines.push(line);
    });
    reportCacheRead("our_year", 10_000, { shopId: "shop-1" }, 10_000 + 60_000);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      event: "cache.read",
      level: "info",
      cache: "our_year",
      outcome: "hit",
      ageS: 60,
      shopId: "shop-1",
    });
  });
});

/**
 * **A cached read of a shop's rows turns over when an e2e route rewrites
 * them**: the shopfront's month sightings, cached before a test seeded its
 * `monthSightings` fact, kept the empty answer (CI run 43120376056).
 */
describe("shopRowsCacheGeneration", () => {
  it("starts a new generation, and so a new cache key, on every expiry", () => {
    const before = shopRowsCacheGeneration();
    expireShopRowsCaches();
    expect(shopRowsCacheGeneration()).toBe(before + 1);
    expireShopRowsCaches();
    expect(shopRowsCacheGeneration()).toBe(before + 2);
  });
});
