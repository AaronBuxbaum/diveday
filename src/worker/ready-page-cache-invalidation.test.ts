import { beforeEach, describe, expect, it, vi } from "vitest";
import { LEGACY_READY_BANNER_COPY } from "@/i18n/ready-offline-legacy";
import {
  READY_CACHE_NAME,
  READY_COPY_GENERATED_AT_META,
  READY_COPY_LOCALE_META,
  READY_COPY_TIME_ZONE_META,
  READY_COPY_VERSION,
  READY_COPY_VERSION_META,
  READY_FORGOTTEN_CACHE_NAME,
  READY_KEEP_UNTIL_META,
  READY_OFFLINE_GENERATED_AT_PLACEHOLDER,
  READY_OFFLINE_NOTE_ATTR,
} from "@/lib/ready-offline";
import {
  beginReadyPageRequest,
  forgetReadyPage,
  READY_COPY_KEY,
  READY_COPY_MAX_AGE_MS,
  readyPageFallback,
  saveReadyPage,
} from "./ready-page-cache";

const ORIGIN = "https://dive.day";
const TOKEN = "A".repeat(43);
const OTHER = "B".repeat(43);
const NOW = 1_800_000_000_000;

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

function page(body: string) {
  return new Response(
    `<meta name="${READY_KEEP_UNTIL_META}" content="${Number.MAX_SAFE_INTEGER}"/><meta name="${READY_COPY_VERSION_META}" content="${READY_COPY_VERSION}"/><meta name="${READY_COPY_LOCALE_META}" content="en-US"/><meta name="${READY_COPY_TIME_ZONE_META}" content="America/New_York"/><meta name="${READY_COPY_GENERATED_AT_META}" content="${NOW}"/><p>${body}</p><p ${READY_OFFLINE_NOTE_ATTR}="" hidden="">No signal: ${READY_OFFLINE_GENERATED_AT_PLACEHOLDER}</p>`,
    { headers: { "content-type": "text/html" } },
  );
}

async function pathHash(path: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(path));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function seedLegacyCopy(
  storage: CacheStorage,
  path: string,
  forgottenVersion = "before-cancel",
) {
  await saveReadyPage(storage, path, page("legacy source"), NOW);
  const cache = await storage.open(READY_CACHE_NAME);
  const saved = await cache.match(READY_COPY_KEY);
  if (!saved) throw new Error("expected saved copy");
  const headers = new Headers(saved.headers);
  headers.set("x-diveday-copy-forgotten-version", forgottenVersion);
  const legacyBanner = [...LEGACY_READY_BANNER_COPY.keys()][0];
  if (!legacyBanner) throw new Error("expected recognized legacy banner");
  await cache.put(
    READY_COPY_KEY,
    new Response(`<p ${READY_OFFLINE_NOTE_ATTR}="">${legacyBanner}</p>`, { headers }),
  );
}

describe("ready page invalidation ordering", () => {
  let store: ReturnType<typeof fakeStorage>;

  beforeEach(() => {
    store = fakeStorage();
  });

  it("does not invalidate a pending different-token request when forgetting the old path, including after restart", async () => {
    const oldPath = `/ready/${TOKEN}`;
    const currentPath = `/ready/${OTHER}`;
    const oldRequest = await beginReadyPageRequest(store.storage, oldPath);
    const currentRequest = await beginReadyPageRequest(store.storage, currentPath);

    expect(await forgetReadyPage(store.storage, oldPath, NOW)).toBe(true);
    expect(
      await saveReadyPage(store.storage, currentPath, page("current token"), NOW, currentRequest),
    ).toBe(true);
    expect(
      await saveReadyPage(store.storage, oldPath, page("stale old token"), NOW, oldRequest),
    ).toBe(false);
    expect(await readyPageFallback(store.storage, currentPath, NOW)).toBeDefined();

    vi.resetModules();
    const restarted = await import("./ready-page-cache");
    expect(
      await restarted.saveReadyPage(
        store.storage,
        oldPath,
        page("stale after restart"),
        NOW,
        oldRequest,
      ),
    ).toBe(false);
  });

  it("preserves another token's saved copy when the forgotten token's marker write fails", async () => {
    const oldPath = `/ready/${TOKEN}`;
    const currentPath = `/ready/${OTHER}`;
    await saveReadyPage(store.storage, currentPath, page("current token"), NOW);
    await beginReadyPageRequest(store.storage, oldPath);
    const baseOpen = store.storage.open.bind(store.storage);
    const broken = {
      delete: store.storage.delete.bind(store.storage),
      open: async (name: string) => {
        const cache = await baseOpen(name);
        if (name !== READY_FORGOTTEN_CACHE_NAME) return cache;
        return {
          ...cache,
          put: async () => {
            throw new Error("quota exceeded");
          },
        };
      },
    } as unknown as CacheStorage;

    expect(await forgetReadyPage(broken, oldPath, NOW)).toBe(false);
    expect(await readyPageFallback(store.storage, currentPath, NOW)).toBeDefined();
  });

  it("preserves another token's offline copy when cancellation state is recorded for this path", async () => {
    const forgottenPath = `/ready/${TOKEN}`;
    const currentPath = `/ready/${OTHER}`;
    await saveReadyPage(store.storage, currentPath, page("current token"), NOW);
    await beginReadyPageRequest(store.storage, currentPath);

    expect(await forgetReadyPage(store.storage, forgottenPath, NOW)).toBe(true);
    expect(await (await readyPageFallback(store.storage, currentPath, NOW))?.text()).toContain(
      "current token",
    );
  });

  it("does not serve a matching copy after the marker persists but deletion is interrupted", async () => {
    const path = `/ready/${TOKEN}`;
    await saveReadyPage(store.storage, path, page("cancelled copy"), NOW);
    const baseOpen = store.storage.open.bind(store.storage);
    const interrupted = {
      delete: async (name: string) =>
        name === READY_CACHE_NAME ? false : store.storage.delete(name),
      open: async (name: string) => {
        const cache = await baseOpen(name);
        if (name !== READY_CACHE_NAME) return cache;
        return {
          ...cache,
          delete: async () => {
            throw new Error("worker terminated");
          },
        };
      },
    } as unknown as CacheStorage;

    expect(await forgetReadyPage(interrupted, path, NOW)).toBe(false);
    vi.resetModules();
    const restarted = await import("./ready-page-cache");
    expect(await restarted.readyPageFallback(store.storage, path, NOW)).toBeUndefined();
  });

  it("honors an old hashed cancellation marker when no new marker exists after restart", async () => {
    const path = `/ready/${TOKEN}`;
    await seedLegacyCopy(store.storage, path);
    const markers = await store.storage.open(READY_FORGOTTEN_CACHE_NAME);
    await markers.put(
      `/ready/forgotten/${await pathHash(path)}`,
      new Response(null, { headers: { "x-diveday-forgotten-version": "after-cancel" } }),
    );
    vi.resetModules();
    const restarted = await import("./ready-page-cache");

    expect(await restarted.readyPageFallback(store.storage, path, NOW)).toBeUndefined();
  });

  it("honors the predecessor timestamp-only cancellation marker after restart", async () => {
    const path = `/ready/${TOKEN}`;
    await seedLegacyCopy(store.storage, path);
    const cache = await store.storage.open(READY_CACHE_NAME);
    const saved = await cache.match(READY_COPY_KEY);
    if (!saved) throw new Error("expected legacy copy");
    const headers = new Headers(saved.headers);
    headers.delete("x-diveday-copy-forgotten-version");
    await cache.put(READY_COPY_KEY, new Response(await saved.text(), { headers }));
    const markers = await store.storage.open(READY_FORGOTTEN_CACHE_NAME);
    await markers.put(
      `/ready/forgotten/${await pathHash(path)}`,
      new Response(null, { headers: { "x-diveday-forgotten-at": String(NOW) } }),
    );
    vi.resetModules();
    const restarted = await import("./ready-page-cache");

    expect(await restarted.readyPageFallback(store.storage, path, NOW)).toBeUndefined();
  });

  it("migrates a timestamp-only cancellation marker before online navigation can fail", async () => {
    const path = `/ready/${TOKEN}`;
    await seedLegacyCopy(store.storage, path);
    const cache = await store.storage.open(READY_CACHE_NAME);
    const saved = await cache.match(READY_COPY_KEY);
    if (!saved) throw new Error("expected legacy copy");
    const headers = new Headers(saved.headers);
    headers.delete("x-diveday-copy-forgotten-version");
    await cache.put(READY_COPY_KEY, new Response(await saved.text(), { headers }));
    const markers = await store.storage.open(READY_FORGOTTEN_CACHE_NAME);
    await markers.put(
      `/ready/forgotten/${await pathHash(path)}`,
      new Response(null, { headers: { "x-diveday-forgotten-at": String(NOW) } }),
    );
    vi.resetModules();
    const restarted = await import("./ready-page-cache");

    const request = await restarted.beginReadyPageRequest(store.storage, path);
    expect(request.durable).toBe(true);
    expect(request.forgottenVersion).toBe(`legacy-at:${NOW}`);
    // Simulate the online fetch failing: after marker migration, fallback must
    // still reject the pre-cancel copy, while the marker cache remains bounded.
    expect(await restarted.readyPageFallback(store.storage, path, NOW)).toBeUndefined();
    expect(await (await store.storage.open(READY_FORGOTTEN_CACHE_NAME)).keys()).toHaveLength(1);
  });

  it("migrates an old hashed cancellation marker into the bounded record before pruning it", async () => {
    const path = `/ready/${TOKEN}`;
    await seedLegacyCopy(store.storage, path);
    const markers = await store.storage.open(READY_FORGOTTEN_CACHE_NAME);
    await markers.put(
      `/ready/forgotten/${await pathHash(path)}`,
      new Response(null, { headers: { "x-diveday-forgotten-version": "after-cancel" } }),
    );
    vi.resetModules();
    const restarted = await import("./ready-page-cache");

    const request = await restarted.beginReadyPageRequest(store.storage, path);
    expect(request.forgottenVersion).toBe("after-cancel");
    expect(await (await store.storage.open(READY_FORGOTTEN_CACHE_NAME)).keys()).toHaveLength(1);
    expect(await restarted.readyPageFallback(store.storage, path, NOW)).toBeUndefined();

    expect(
      await restarted.saveReadyPage(store.storage, path, page("fresh server copy"), NOW, request),
    ).toBe(true);
    expect(await (await restarted.readyPageFallback(store.storage, path, NOW))?.text()).toContain(
      "fresh server copy",
    );
  });

  it("fails closed when durable cancellation state cannot be read", async () => {
    const path = `/ready/${TOKEN}`;
    await saveReadyPage(store.storage, path, page("saved copy"), NOW);
    const broken = {
      delete: store.storage.delete.bind(store.storage),
      open: async (name: string) => {
        if (name === READY_FORGOTTEN_CACHE_NAME) throw new Error("storage unavailable");
        return store.storage.open(name);
      },
    } as unknown as CacheStorage;

    expect(await readyPageFallback(broken, path, NOW)).toBeUndefined();
    expect(await readyPageFallback(store.storage, path, NOW)).toBeDefined();
  });

  it("keeps recognized legacy copies with the selected unknown-time warning", async () => {
    const path = `/ready/${TOKEN}`;
    await saveReadyPage(store.storage, path, page("legacy source"), NOW);
    const cache = await store.storage.open(READY_CACHE_NAME);
    const saved = await cache.match(READY_COPY_KEY);
    if (!saved) throw new Error("expected saved copy");
    const headers = new Headers(saved.headers);
    headers.delete("x-diveday-copy-forgotten-version");
    const legacyBanner = [...LEGACY_READY_BANNER_COPY.entries()][0];
    if (!legacyBanner) throw new Error("expected recognized legacy banner");
    await cache.put(
      READY_COPY_KEY,
      new Response(`<p ${READY_OFFLINE_NOTE_ATTR}="">${legacyBanner[0]}</p>`, { headers }),
    );

    const served = await readyPageFallback(store.storage, path, NOW + READY_COPY_MAX_AGE_MS - 1);
    expect(await served?.text()).toContain(legacyBanner[1]);
  });

  it("serializes an old-path forget against a different-token request acquiring the marker", async () => {
    const oldPath = `/ready/${TOKEN}`;
    const currentPath = `/ready/${OTHER}`;
    await beginReadyPageRequest(store.storage, oldPath);
    const baseOpen = store.storage.open.bind(store.storage);
    let pauseMatch = true;
    let enteredMatch: (() => void) | undefined;
    let releaseMatch: (() => void) | undefined;
    const matchEntered = new Promise<void>((resolve) => {
      enteredMatch = resolve;
    });
    const matchGate = new Promise<void>((resolve) => {
      releaseMatch = resolve;
    });
    const racing = {
      delete: store.storage.delete.bind(store.storage),
      open: async (name: string) => {
        const cache = await baseOpen(name);
        if (name !== READY_FORGOTTEN_CACHE_NAME) return cache;
        return {
          ...cache,
          match: async (key: string | Request) => {
            if (pauseMatch) {
              pauseMatch = false;
              enteredMatch?.();
              await matchGate;
            }
            return cache.match(key);
          },
        };
      },
    } as unknown as CacheStorage;
    const forgetting = forgetReadyPage(racing, oldPath, NOW);
    await matchEntered;
    const currentRequest = beginReadyPageRequest(store.storage, currentPath);
    releaseMatch?.();

    expect(await forgetting).toBe(true);
    const request = await currentRequest;
    expect(
      await saveReadyPage(store.storage, currentPath, page("current token"), NOW, request),
    ).toBe(true);
  });

  it("serializes terminal path checks with a concurrent request for another token", async () => {
    const path = `/ready/${TOKEN}`;
    const otherPath = `/ready/${OTHER}`;
    await saveReadyPage(store.storage, path, page("old token"), NOW);
    const terminalRequest = await beginReadyPageRequest(store.storage, path);
    const baseOpen = store.storage.open.bind(store.storage);
    let blockNextMatch = true;
    let enteredMatch: (() => void) | undefined;
    let releaseMatch: (() => void) | undefined;
    const matchEntered = new Promise<void>((resolve) => {
      enteredMatch = resolve;
    });
    const matchGate = new Promise<void>((resolve) => {
      releaseMatch = resolve;
    });
    const racing = {
      delete: store.storage.delete.bind(store.storage),
      open: async (name: string) => {
        const cache = await baseOpen(name);
        if (name !== READY_FORGOTTEN_CACHE_NAME) return cache;
        return {
          ...cache,
          match: async (key: string | Request) => {
            if (blockNextMatch) {
              blockNextMatch = false;
              enteredMatch?.();
              await matchGate;
            }
            return cache.match(key);
          },
        };
      },
    } as unknown as CacheStorage;
    const terminal = saveReadyPage(
      racing,
      path,
      new Response("Cancelled", { headers: { "content-type": "text/html" } }),
      NOW,
      terminalRequest,
    );
    await matchEntered;
    const newerRequest = beginReadyPageRequest(store.storage, otherPath);
    releaseMatch?.();

    expect(await terminal).toBe(false);
    const next = await newerRequest;
    expect(await saveReadyPage(store.storage, otherPath, page("new token"), NOW, next)).toBe(true);
    expect(await readyPageFallback(store.storage, otherPath, NOW)).toBeDefined();
  });
});
