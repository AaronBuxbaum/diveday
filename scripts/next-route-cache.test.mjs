import { createRequire, registerHooks } from "node:module";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
let cache;
let createCacheKey;
let transportHook;

beforeAll(() => {
  vi.stubEnv("__NEXT_CLIENT_ROUTER_STATIC_STALETIME", "300");
  // Next supplies this alias in its browser bundle. These cache-only cases
  // never decode Flight or fetch; stub that transport edge, not cache logic.
  const flightStub = "next-route-cache-test:flight-client";
  transportHook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "react-server-dom-webpack/client")
        return { url: flightStub, shortCircuit: true };
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === flightStub)
        return { format: "commonjs", source: "module.exports = {};", shortCircuit: true };
      return nextLoad(url, context);
    },
  });
  // Exercise the installed dependency, so a missing pnpm patch fails this test.
  cache = require("next/dist/client/components/segment-cache/cache.js");
  ({ createCacheKey } = require("next/dist/client/components/segment-cache/cache-key.js"));
});
afterAll(() => {
  transportHook?.deregister();
  vi.unstubAllEnvs();
});

const root = {
  tree: { data: null, slots: null, prefetchHints: 0 },
  head: { data: null, slots: null, prefetchHints: 0 },
};
const now = 1_000;
const cases = [
  ["/shop/blue-mantis/waivers#course-form-new", "/shop/blue-mantis/waivers"],
  ["/shop/blue-mantis/waivers?form=new", "/shop/blue-mantis/waivers?form=new"],
  [
    "/shop/encoded%23shop/waivers?return=%23course&form=new#course-form-new",
    "/shop/encoded%23shop/waivers?return=%23course&form=new",
  ],
];

describe("Next route-cache canonical URLs", () => {
  test.each(cases)("fulfillment shares %s across destination fragments", (canonical, expected) => {
    const pending = {
      status: cache.EntryStatus.Pending,
      blockedTasks: null,
      canonicalUrl: null,
      root: null,
      renderedSearch: null,
      supportsPerSegmentPrefetching: false,
      couldBeIntercepted: true,
      predictedFrom: null,
      ref: null,
      size: 0,
      staleAt: Infinity,
      version: 0,
    };
    const entry = cache.fulfillRouteCacheEntry(now, pending, root, false, canonical, "", false);
    expect(entry).toBe(pending);
    expect(entry.status).toBe(cache.EntryStatus.Fulfilled);
    expect(entry.canonicalUrl).toBe(expected);
  });

  test.each(cases)(
    "cached reads of %s do not retain a previous fragment",
    (canonical, expected) => {
      const source = new URL(canonical, "https://diveday.test");
      const entry = cache.writeRouteIntoCache(
        now,
        source.pathname,
        source.search,
        null,
        root,
        false,
        canonical,
        source.search,
        false,
      );
      for (const hash of ["#course-form-new", "#course-forms", ""]) {
        const destination = new URL(source);
        destination.hash = hash;
        const stored = cache.readRouteCacheEntry(now, createCacheKey(destination.href, null));
        expect(stored).toBe(entry);
        expect(stored.canonicalUrl).toBe(expected);
      }
    },
  );
});
