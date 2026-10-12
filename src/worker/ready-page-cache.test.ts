// The default `node` environment, as the worker's own test: this module runs
// in a service worker, never in a DOM context.
import { beforeEach, describe, expect, it } from "vitest";
import {
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

function page(body = "<p>Ready</p>", init: ResponseInit = {}) {
  return new Response(body, {
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
    expect([...(store.caches.get(READY_CACHE_NAME)?.keys() ?? [])]).toEqual([`/ready/${TOKEN}`]);

    const served = await readyPageFallback(store.storage, `/ready/${TOKEN}`, NOW + 1000);
    expect(await served?.text()).toBe("newer");
    expect(await readyPageFallback(store.storage, `/ready/${OTHER}`, NOW)).toBeUndefined();
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
