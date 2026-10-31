// The default `node` environment: these tests exercise the service worker without a DOM.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { READY_CACHE_NAME } from "@/lib/ready-offline";
import {
  forgetReadyPage,
  READY_COPY_KEY,
  readyPageFallback,
  saveReadyPage,
} from "./ready-page-cache";
import { DAY_MS, NOW, page, snapshotOf, stubSnapshotReply } from "./ready-test-support";

const ORIGIN = "https://dive.day";
const TOKEN = "A".repeat(43);

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A Cache Storage with just the surface the module uses, keyed by path. */
function fakeStorage() {
  const caches = new Map<string, Map<string, Response>>();
  const pathOf = (key: string | Request) =>
    new URL(typeof key === "string" ? key : key.url, ORIGIN).pathname;
  const storage = {
    delete: async (name: string) => caches.delete(name),
    open: async (name: string) => {
      const entries = caches.get(name) ?? new Map<string, Response>();
      caches.set(name, entries);
      return {
        keys: async () => [...entries.keys()].map((path) => new Request(`${ORIGIN}${path}`)),
        delete: async (key: string | Request) => entries.delete(pathOf(key)),
        put: async (key: string | Request, response: Response) => {
          entries.set(pathOf(key), response);
        },
        match: async (key: string | Request) => entries.get(pathOf(key))?.clone(),
      };
    },
  };
  return { storage: storage as unknown as CacheStorage, caches };
}

describe("ready-page clock rollback", () => {
  let store: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    store = fakeStorage();
  });

  it("persists an online clock watermark across restart and detects its rollback", async () => {
    const path = `/ready/${TOKEN}`;
    const body = "offline trip copy";
    const higherClock = NOW + 2 * 60 * 60 * 1000;
    expect(
      await saveReadyPage(store.storage, path, page(body, {}, NOW + DAY_MS), higherClock),
    ).toBe(true);
    const clockCache = await store.storage.open("diveday-ready-clock-v1");
    let marker = await clockCache.match("/ready/clock-observation");
    expect(marker?.headers.get("x-diveday-clock-watermark")).toBe(String(higherClock));

    await vi.resetModules();
    const restartedWorker = await import("./ready-page-cache");
    expect(
      await restartedWorker.saveReadyPage(
        store.storage,
        path,
        page(body, {}, NOW + DAY_MS),
        higherClock - 1,
      ),
    ).toBe(true);
    marker = await clockCache.match("/ready/clock-observation");
    expect(marker?.headers.get("x-diveday-clock-watermark")).toBe(String(higherClock));

    const rolledBack = await restartedWorker.readyPageFallback(store.storage, path, NOW);
    expect(await rolledBack?.text()).toContain("Phone clock looks wrong");
    expect(rolledBack?.headers.get("x-diveday-ready-copy-time-state")).toBe("rollback");
  });

  it("keeps a server-current page through a restart when the device clock is past trip expiry", async () => {
    const keepUntil = NOW + DAY_MS;
    const deviceClockAheadAtSave = NOW + 3 * DAY_MS;
    const body = "offline trip copy";
    const kept = await saveReadyPage(
      store.storage,
      `/ready/${TOKEN}`,
      page(body, {}, keepUntil),
      deviceClockAheadAtSave,
    );

    expect(kept).toBe(true);
    // Cache Storage survives a service-worker restart; module-local state does not.
    await vi.resetModules();
    const restartedWorker = await import("./ready-page-cache");
    const served = await restartedWorker.readyPageFallback(
      store.storage,
      `/ready/${TOKEN}`,
      deviceClockAheadAtSave,
    );
    expect(await served?.text()).toContain("offline trip copy");

    // A later clock correction is still detected and fails closed, but it
    // does not destroy the copy needed if the clock is restored or verified.
    const correctedClock = await restartedWorker.readyPageFallback(
      store.storage,
      `/ready/${TOKEN}`,
      NOW + 60 * 60 * 1000,
    );
    expect(await correctedClock?.text()).toContain("Phone clock looks wrong");
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(1);

    // Once the calibrated server-time estimate reaches the actual expiry, the
    // copy is removed even though the device's wall clock has a fixed offset.
    expect(
      await restartedWorker.readyPageFallback(
        store.storage,
        `/ready/${TOKEN}`,
        deviceClockAheadAtSave + DAY_MS + 1,
      ),
    ).toBeUndefined();
  });

  it("does not mistake a consistently slow device clock for a rollback", async () => {
    const deviceClockBehindAtSave = NOW - 60 * 60 * 1000;
    expect(
      await saveReadyPage(
        store.storage,
        `/ready/${TOKEN}`,
        page("offline trip copy", {}, NOW + DAY_MS),
        deviceClockBehindAtSave,
      ),
    ).toBe(true);

    const served = await readyPageFallback(
      store.storage,
      `/ready/${TOKEN}`,
      deviceClockBehindAtSave,
    );
    expect(await served?.text()).toContain("offline trip copy");
    expect(served?.headers.get("x-diveday-ready-copy-time-state")).toBe("known");
  });

  it("keeps the page but warns when a corrupt watermark hides an earlier high clock reading", async () => {
    const path = `/ready/${TOKEN}`;
    const body = "offline trip copy";
    expect(await saveReadyPage(store.storage, path, page(body), NOW + 2 * 60 * 60 * 1000)).toBe(
      true,
    );
    const pageCache = await store.storage.open(READY_CACHE_NAME);
    const saved = await pageCache.match(READY_COPY_KEY);
    expect(saved).toBeDefined();
    const headers = new Headers(saved?.headers);
    headers.set("x-diveday-device-saved-at", String(NOW));
    await pageCache.put(
      READY_COPY_KEY,
      new Response(await saved?.text(), {
        status: saved?.status,
        statusText: saved?.statusText,
        headers,
      }),
    );
    const clockCache = await store.storage.open("diveday-ready-clock-v1");
    await clockCache.put(
      "/ready/clock-observation",
      new Response(null, { headers: { "x-diveday-clock-watermark": "corrupt" } }),
    );

    const served = await readyPageFallback(store.storage, path, NOW + 60 * 60 * 1000);
    const text = await served?.text();

    expect(text).toContain("offline trip copy");
    expect(text).toContain("Clock not verified.");
    expect(served?.headers.get("x-diveday-ready-copy-time-state")).toBe("unverified");
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(1);

    const confirmedRollback = await readyPageFallback(store.storage, path, NOW - 1);
    expect(await confirmedRollback?.text()).toContain("Phone clock looks wrong");
    expect(confirmedRollback?.headers.get("x-diveday-ready-copy-time-state")).toBe("rollback");
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(1);
  });

  it("keeps the page but warns when the watermark cannot be read", async () => {
    const path = `/ready/${TOKEN}`;
    const body = "offline trip copy";
    expect(await saveReadyPage(store.storage, path, page(body), NOW)).toBe(true);
    const originalOpen = store.storage.open.bind(store.storage);
    vi.spyOn(store.storage, "open").mockImplementation(async (name) => {
      const cache = await originalOpen(name);
      return name === "diveday-ready-clock-v1"
        ? { ...cache, match: async () => Promise.reject(new Error("clock watermark unavailable")) }
        : cache;
    });

    const served = await readyPageFallback(store.storage, path, NOW + 1000);
    const text = await served?.text();

    expect(text).toContain("offline trip copy");
    expect(text).toContain("Clock not verified.");
    expect(served?.headers.get("x-diveday-ready-copy-time-state")).toBe("unverified");
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(1);
  });

  it("cancellation still removes a calibrated copy while the device clock is skewed", async () => {
    const path = `/ready/${TOKEN}`;
    const keepUntil = NOW + DAY_MS;
    const deviceClockAheadAtSave = NOW + 3 * DAY_MS;
    expect(
      await saveReadyPage(
        store.storage,
        path,
        page("offline trip copy", {}, keepUntil),
        deviceClockAheadAtSave,
      ),
    ).toBe(true);

    expect(await forgetReadyPage(store.storage, path, deviceClockAheadAtSave + 1)).toBe(true);
    expect(
      await readyPageFallback(store.storage, path, deviceClockAheadAtSave + 2),
    ).toBeUndefined();
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(0);
  });

  it("serves the server's own warning, and none of the saved page, after a detected rollback", async () => {
    stubSnapshotReply(
      snapshotOf("<button>Running late</button>", {
        rollback: "<h1>Phone clock looks wrong</h1><p>Generated Oct 14, 2:40 PM EDT</p>",
      }),
    );
    expect(
      await saveReadyPage(
        store.storage,
        `/ready/${TOKEN}`,
        new Response("<p>live</p>", { headers: { "content-type": "text/html" } }),
        NOW + 100,
      ),
    ).toBe(true);

    const served = await readyPageFallback(store.storage, `/ready/${TOKEN}`, NOW);
    const text = await served?.text();
    expect(text).toContain("Phone clock looks wrong");
    expect(text).toContain("Generated Oct 14, 2:40 PM EDT");
    expect(text).not.toContain("Running late");
    expect(served?.headers.get("x-diveday-ready-copy-time-state")).toBe("rollback");
  });

  it("expires by the server's clock, not the phone's, after a fixed offset", async () => {
    const path = `/ready/${TOKEN}`;
    const deviceAhead = NOW + 5 * DAY_MS;
    expect(
      await saveReadyPage(store.storage, path, page("trip", {}, NOW + DAY_MS), deviceAhead),
    ).toBe(true);
    // Half a day on the phone is half a day on the server, whatever the phone reads.
    expect(await readyPageFallback(store.storage, path, deviceAhead + DAY_MS / 2)).toBeDefined();
    expect(await readyPageFallback(store.storage, path, deviceAhead + DAY_MS + 1)).toBeUndefined();
    expect(store.caches.get(READY_CACHE_NAME)?.size ?? 0).toBe(0);
  });

  it("deletes a copy that lost its save time instead of serving it after a clock rollback", async () => {
    await saveReadyPage(store.storage, `/ready/${TOKEN}`, page("current copy"), NOW + 100);
    const cache = await store.storage.open(READY_CACHE_NAME);
    const saved = await cache.match(READY_COPY_KEY);
    expect(saved).toBeDefined();
    const headers = new Headers(saved?.headers);
    headers.delete("x-diveday-device-saved-at");
    await cache.put(READY_COPY_KEY, new Response(await saved?.text(), { headers }));

    expect(await readyPageFallback(store.storage, `/ready/${TOKEN}`, NOW)).toBeUndefined();
    expect(store.caches.get(READY_CACHE_NAME)?.size ?? 0).toBe(0);
  });
});
