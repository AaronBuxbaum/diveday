// The default `node` environment, as the worker's own test: this module runs
// in a service worker, never in a DOM context.
import { beforeEach, describe, expect, it } from "vitest";
import { READY_KEEP_UNTIL_META } from "@/lib/ready-offline";
import {
  forgetReadyPage,
  isReadyScope,
  READY_CACHE_NAME,
  READY_COPY_MAX_AGE_MS,
  readyPageFallback,
  readyPagePath,
  readyPageStylesheets,
  saveReadyPage,
} from "./ready-page-cache";

const ORIGIN = "https://dive.day";
const TOKEN = "A".repeat(43);
const OTHER = "B".repeat(43);
const NOW = 1_800_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A Cache Storage with just the surface the module uses, keyed by path. */
function fakeStorage() {
  const caches = new Map<string, Map<string, Response>>();
  const pathOf = (key: string | Request) =>
    new URL(typeof key === "string" ? key : key.url, ORIGIN).pathname;
  const storage = {
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

/** The live page as the server renders it: kept until `keepUntil` (default: well past NOW). */
function page(body = "<p>Ready</p>", init: ResponseInit = {}, keepUntil = NOW + 30 * DAY_MS) {
  return new Response(`<meta name="${READY_KEEP_UNTIL_META}" content="${keepUntil}"/>${body}`, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    ...init,
  });
}

describe("readyPagePath", () => {
  it("answers a readiness link on this origin and nothing else", () => {
    expect(readyPagePath(new URL(`${ORIGIN}/ready/${TOKEN}`), ORIGIN)).toBe(`/ready/${TOKEN}`);
    expect(readyPagePath(new URL(`${ORIGIN}/ready/${TOKEN}?saved=seat`), ORIGIN)).toBe(
      `/ready/${TOKEN}`,
    );
    expect(readyPagePath(new URL(`https://evil.example/ready/${TOKEN}`), ORIGIN)).toBeNull();
    expect(readyPagePath(new URL(`${ORIGIN}/ready/${TOKEN}/forms`), ORIGIN)).toBeNull();
    expect(readyPagePath(new URL(`${ORIGIN}/ready/short`), ORIGIN)).toBeNull();
    expect(readyPagePath(new URL(`${ORIGIN}/shop/blue-mantis`), ORIGIN)).toBeNull();
  });
});

describe("isReadyScope", () => {
  it("is the diver's registration only", () => {
    expect(isReadyScope(`${ORIGIN}/ready/`)).toBe(true);
    expect(isReadyScope(`${ORIGIN}/`)).toBe(false);
    expect(isReadyScope(undefined)).toBe(false);
  });
});

describe("saveReadyPage and readyPageFallback", () => {
  let store: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    store = fakeStorage();
  });

  it("keeps one copy, the last page rendered, and serves it by its own path", async () => {
    expect(await saveReadyPage(store.storage, `/ready/${OTHER}`, page("older"), NOW)).toBe(true);
    expect(await saveReadyPage(store.storage, `/ready/${TOKEN}`, page("newer"), NOW)).toBe(true);
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(1);

    const served = await readyPageFallback(store.storage, `/ready/${TOKEN}`, NOW + 1000);
    expect(await served?.text()).toContain("newer");
    expect(await readyPageFallback(store.storage, `/ready/${OTHER}`, NOW)).toBeUndefined();
  });

  /**
   * Security review of layer 8, D1: Cache Storage is origin-wide, so any
   * same-origin script can list its keys. The copy is filed under one fixed
   * key that carries no token, and answers a path only by its hash.
   */
  it("files the copy under a key that names no token", async () => {
    await saveReadyPage(store.storage, `/ready/${TOKEN}`, page(), NOW);
    const keys = [...(store.caches.get(READY_CACHE_NAME)?.keys() ?? [])];
    expect(keys).toHaveLength(1);
    expect(keys.join(" ")).not.toContain(TOKEN);
    const kept = store.caches.get(READY_CACHE_NAME)?.values().next().value;
    expect([...(kept?.headers.values() ?? [])].join(" ")).not.toContain(TOKEN);
  });

  /** The page's own links carry the token; the stored body must not (D1, residual). */
  it("keeps a body that names the token only with the placeholder, and puts the token back", async () => {
    const body = `<a href="/ready/${TOKEN}/forms">Forms</a><p>${TOKEN}</p>`;
    await saveReadyPage(store.storage, `/ready/${TOKEN}`, page(body), NOW);

    const kept = store.caches.get(READY_CACHE_NAME)?.values().next().value;
    const stored = await kept?.clone().text();
    expect(stored).not.toContain(TOKEN);
    expect(stored).toContain("__diveday_kept_token__");

    const served = await readyPageFallback(store.storage, `/ready/${TOKEN}`, NOW + 1000);
    const text = await served?.text();
    expect(text).toContain(`href="/ready/${TOKEN}/forms"`);
    expect(text).toContain(`<p>${TOKEN}</p>`);
    expect(text).not.toContain("__diveday_kept_token__");
    expect(await readyPageFallback(store.storage, `/ready/${OTHER}`, NOW + 1000)).toBeUndefined();
  });

  /**
   * D2: a copy does not outlive the trip it is for (the page names the day
   * after the boat is due back), and a page that names no day (a cancelled
   * booking, a dead link) clears it rather than replacing it.
   */
  it("stops serving the copy the moment the page said, and keeps none the page did not ask for", async () => {
    const path = `/ready/${TOKEN}`;
    await saveReadyPage(store.storage, path, page("x", {}, NOW + 1000), NOW);
    expect(await readyPageFallback(store.storage, path, NOW + 999)).toBeDefined();
    expect(await readyPageFallback(store.storage, path, NOW + 1001)).toBeUndefined();
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(0);

    await saveReadyPage(store.storage, path, page(), NOW);
    expect(
      await saveReadyPage(
        store.storage,
        path,
        new Response("<p>Cancelled</p>", { headers: { "content-type": "text/html" } }),
        NOW,
      ),
    ).toBe(false);
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(0);
    expect(await saveReadyPage(store.storage, path, page("x", {}, NOW - 1), NOW)).toBe(false);
  });

  it("forgets the copy for a path, and only that path's", async () => {
    await saveReadyPage(store.storage, `/ready/${TOKEN}`, page(), NOW);
    await forgetReadyPage(store.storage, `/ready/${OTHER}`);
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(1);
    await forgetReadyPage(store.storage, `/ready/${TOKEN}`);
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(0);
  });

  it("keeps nothing that is not the page itself", async () => {
    const path = `/ready/${TOKEN}`;
    expect(await saveReadyPage(store.storage, path, page("x", { status: 404 }), NOW)).toBe(false);
    expect(
      await saveReadyPage(
        store.storage,
        path,
        new Response("{}", { headers: { "content-type": "application/json" } }),
        NOW,
      ),
    ).toBe(false);
    const redirected = page();
    Object.defineProperty(redirected, "redirected", { value: true });
    expect(await saveReadyPage(store.storage, path, redirected, NOW)).toBe(false);
    const opaque = page();
    Object.defineProperty(opaque, "type", { value: "opaque" });
    expect(await saveReadyPage(store.storage, path, opaque, NOW)).toBe(false);
    expect(await readyPageFallback(store.storage, path, NOW)).toBeUndefined();
  });

  it("deletes a copy older than two weeks rather than serving it", async () => {
    const path = `/ready/${TOKEN}`;
    await saveReadyPage(store.storage, path, page(), NOW);
    expect(await readyPageFallback(store.storage, path, NOW + READY_COPY_MAX_AGE_MS + 1)).toBe(
      undefined,
    );
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(0);
  });
});

describe("readyPageStylesheets", () => {
  it("finds the page's own stylesheets and nobody else's", () => {
    const html = `<link rel="stylesheet" href="/_next/static/css/app.css"/><link href="https://cdn.example/_next/static/css/x.css"/><script src="/_next/static/chunks/a.js"></script>`;
    expect(readyPageStylesheets(html, ORIGIN)).toEqual(["/_next/static/css/app.css"]);
  });
});
