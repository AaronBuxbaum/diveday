// The default `node` environment: these tests exercise the service worker without a DOM.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  READY_CACHE_NAME,
  READY_COPY_GENERATED_AT_META,
  READY_COPY_LOCALE_META,
  READY_COPY_TIME_ZONE_META,
  READY_COPY_VERSION,
  READY_COPY_VERSION_META,
  READY_KEEP_UNTIL_META,
  READY_OFFLINE_GENERATED_AT_PLACEHOLDER,
  READY_OFFLINE_NOTE_ATTR,
  READY_ROLLBACK_SAVED_AT_PLACEHOLDER,
} from "@/lib/ready-offline";
import {
  forgetReadyPage,
  READY_COPY_KEY,
  readyPageFallback,
  saveReadyPage,
} from "./ready-page-cache";

const ORIGIN = "https://dive.day";
const TOKEN = "A".repeat(43);
const NOW = 1_800_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

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

/** A current-format response with no automatic banner, for malformed-page tests. */
function renderedPage(body: string, init: ResponseInit = {}, keepUntil = NOW + 30 * DAY_MS) {
  return new Response(
    `<meta name="${READY_KEEP_UNTIL_META}" content="${keepUntil}"/><meta name="${READY_COPY_VERSION_META}" content="${READY_COPY_VERSION}"/>${body}`,
    {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      ...init,
    },
  );
}

/** The live page as the server renders it: kept until `keepUntil` (default: well past NOW). */
function page(body = "<p>Ready</p>", init: ResponseInit = {}, keepUntil = NOW + 30 * DAY_MS) {
  const generatedAt = body.includes(`name="${READY_COPY_GENERATED_AT_META}"`)
    ? ""
    : `<meta name="${READY_COPY_GENERATED_AT_META}" content="${NOW}"/>`;
  const withBanner = body.includes(`${READY_OFFLINE_NOTE_ATTR}=""`)
    ? `${generatedAt}${body}`
    : `<meta name="${READY_COPY_LOCALE_META}" content="en-US"/><meta name="${READY_COPY_TIME_ZONE_META}" content="America/New_York"/>${generatedAt}${body}<p ${READY_OFFLINE_NOTE_ATTR}="" hidden="">No signal: ${READY_OFFLINE_GENERATED_AT_PLACEHOLDER}</p>`;
  return renderedPage(withBanner, init, keepUntil);
}
describe("ready-page clock rollback", () => {
  let store: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    store = fakeStorage();
  });

  it("persists an online clock watermark across restart and detects its rollback", async () => {
    const path = `/ready/${TOKEN}`;
    const body = `<meta name="${READY_COPY_LOCALE_META}" content="en-US"/><meta name="${READY_COPY_TIME_ZONE_META}" content="America/New_York"/><html><body><main><p ${READY_OFFLINE_NOTE_ATTR}="" hidden="">No signal: ${READY_OFFLINE_GENERATED_AT_PLACEHOLDER}</p><p>offline trip copy</p><section data-ready-clock-rollback="" hidden><h1>Phone clock looks wrong</h1><p data-ready-clock-rollback-saved="" hidden>Generated ${READY_ROLLBACK_SAVED_AT_PLACEHOLDER}</p><p data-ready-clock-rollback-unknown="" hidden>Saved time unknown</p></section></main></body></html>`;
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
    const body = `<meta name="${READY_COPY_LOCALE_META}" content="en-US"/><meta name="${READY_COPY_TIME_ZONE_META}" content="America/New_York"/><html><body><main><p ${READY_OFFLINE_NOTE_ATTR}="" hidden="">No signal: ${READY_OFFLINE_GENERATED_AT_PLACEHOLDER}</p><p>offline trip copy</p><section data-ready-clock-rollback="" hidden=""><h1>Phone clock looks wrong</h1><p data-ready-clock-rollback-saved="" hidden="">Generated ${READY_ROLLBACK_SAVED_AT_PLACEHOLDER}</p><p data-ready-clock-rollback-unknown="" hidden="">Saved time unknown</p></section></main></body></html>`;
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
    const body = `<meta name="${READY_COPY_LOCALE_META}" content="en-US"/><meta name="${READY_COPY_TIME_ZONE_META}" content="America/New_York"/><html><body><main><p ${READY_OFFLINE_NOTE_ATTR}="" hidden="">No signal: ${READY_OFFLINE_GENERATED_AT_PLACEHOLDER}</p><p>offline trip copy</p><section data-ready-clock-rollback="" hidden><h1>Phone clock looks wrong</h1><p data-ready-clock-rollback-saved="" hidden>Generated ${READY_ROLLBACK_SAVED_AT_PLACEHOLDER}</p><p data-ready-clock-rollback-unknown="" hidden>Saved time unknown</p></section><section data-ready-clock-unverified="" hidden><p data-ready-clock-unverified-copy="" hidden>Phone clock could not be verified. Reconnect to check current trip details.</p></section></main></body></html>`;
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
    expect(text).toContain("Phone clock could not be verified");
    expect(served?.headers.get("x-diveday-ready-copy-time-state")).toBe("unverified");
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(1);

    const confirmedRollback = await readyPageFallback(store.storage, path, NOW - 1);
    expect(await confirmedRollback?.text()).toContain("Phone clock looks wrong");
    expect(confirmedRollback?.headers.get("x-diveday-ready-copy-time-state")).toBe("rollback");
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(1);
  });

  it("keeps the page but warns when the watermark cannot be read", async () => {
    const path = `/ready/${TOKEN}`;
    const body = `<meta name="${READY_COPY_LOCALE_META}" content="en-US"/><meta name="${READY_COPY_TIME_ZONE_META}" content="America/New_York"/><html><body><main><p ${READY_OFFLINE_NOTE_ATTR}="" hidden="">No signal: ${READY_OFFLINE_GENERATED_AT_PLACEHOLDER}</p><p>offline trip copy</p><section data-ready-clock-unverified="" hidden><p data-ready-clock-unverified-copy="" hidden>Phone clock could not be verified. Reconnect to check current trip details.</p></section></main></body></html>`;
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
    expect(text).toContain("Phone clock could not be verified");
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

  it("replaces the readiness page with a timestamped warning after a detected rollback", async () => {
    const serverSavedAt = NOW;
    const html = `<meta name="${READY_COPY_LOCALE_META}" content="en-US"/><meta name="${READY_COPY_TIME_ZONE_META}" content="America/New_York"/><meta name="${READY_COPY_GENERATED_AT_META}" content="${serverSavedAt}"/><html><body><main><p ${READY_OFFLINE_NOTE_ATTR}="" hidden="">No signal: ${READY_OFFLINE_GENERATED_AT_PLACEHOLDER}</p><button>Running late</button><section data-ready-clock-rollback="" hidden=""><h1>Phone clock looks wrong</h1><p data-ready-clock-rollback-saved="" hidden="">Generated ${READY_ROLLBACK_SAVED_AT_PLACEHOLDER}</p><p data-ready-clock-rollback-unknown="" hidden="">Saved time unknown</p></section></main></body></html>`;
    expect(await saveReadyPage(store.storage, `/ready/${TOKEN}`, page(html), NOW + 100)).toBe(true);

    const served = await readyPageFallback(store.storage, `/ready/${TOKEN}`, NOW);
    const text = await served?.text();
    expect(text).toContain("Phone clock looks wrong");
    const generatedLabel = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone: "America/New_York",
    }).format(new Date(serverSavedAt));
    expect(text?.replaceAll("\u00a0", " ")).toContain(
      `Generated ${generatedLabel.replaceAll("\u00a0", " ")}`,
    );
    expect(text).not.toContain("Running late");
    expect(served?.headers.get("x-diveday-ready-copy-time-state")).toBe("rollback");
  });

  it("keeps a legacy copy and shows an unknown-time rollback warning", async () => {
    await saveReadyPage(store.storage, `/ready/${TOKEN}`, page("current copy"), NOW + 100);
    const cache = await store.storage.open(READY_CACHE_NAME);
    const saved = await cache.match(READY_COPY_KEY);
    expect(saved).toBeDefined();
    await cache.put(
      READY_COPY_KEY,
      new Response(
        `<p ${READY_OFFLINE_NOTE_ATTR}="">No signal: this is the copy your phone saved. Anything you change here needs signal.</p>`,
        { headers: saved?.headers },
      ),
    );

    const served = await readyPageFallback(store.storage, `/ready/${TOKEN}`, NOW);
    const text = await served?.text();
    expect(text).toContain("Phone clock looks wrong");
    expect(text).toContain("The saved time is unknown.");
    expect(text).not.toContain("current copy");
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(1);
  });
});
