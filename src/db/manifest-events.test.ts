import { describe, expect, it } from "vitest";
import type { AppDb } from "./client";
import { publishManifestEvent, subscribeManifestEvents } from "./manifest-events";

// vitest.config.ts sets DATABASE_URL to "" for every test worker, so this
// suite always exercises the in-process dispatch fallback (dev/test on
// PGlite has no cross-process notify to model) — see the module docblock and
// ADR 20260726-manifest-push-refresh for the Postgres LISTEN/NOTIFY path this
// intentionally doesn't cover.

// That same empty DATABASE_URL makes `publishManifestEvent` return from its
// in-process dispatch branch before it ever touches the database (see
// manifest-events.ts), so booting a real PGlite here would cost ~5s per test
// to hand it an argument nothing reads. A typed stand-in is the honest fixture.
const db = {} as AppDb;

describe("manifest-events", () => {
  it("notifies a subscriber only for its own shop and trip", async () => {
    const received: string[] = [];
    const unsubscribe = subscribeManifestEvents("shop-a", "trip-1", () => received.push("a"));
    try {
      await publishManifestEvent(db, "shop-a", "trip-2");
      await publishManifestEvent(db, "shop-b", "trip-1");
      expect(received).toEqual([]);

      await publishManifestEvent(db, "shop-a", "trip-1");
      expect(received).toEqual(["a"]);
    } finally {
      unsubscribe();
    }
  });

  it("stops delivering after unsubscribe", async () => {
    let count = 0;
    const unsubscribe = subscribeManifestEvents("shop-a", "trip-1", () => {
      count++;
    });
    await publishManifestEvent(db, "shop-a", "trip-1");
    expect(count).toBe(1);

    unsubscribe();
    await publishManifestEvent(db, "shop-a", "trip-1");
    expect(count).toBe(1);
  });

  it("notifies every independent subscriber to the same trip", async () => {
    let first = 0;
    let second = 0;
    const unsubscribeFirst = subscribeManifestEvents("shop-a", "trip-1", () => {
      first++;
    });
    const unsubscribeSecond = subscribeManifestEvents("shop-a", "trip-1", () => {
      second++;
    });
    try {
      await publishManifestEvent(db, "shop-a", "trip-1");
      expect(first).toBe(1);
      expect(second).toBe(1);
    } finally {
      unsubscribeFirst();
      unsubscribeSecond();
    }
  });
});
