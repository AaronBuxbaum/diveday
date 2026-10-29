import { beforeEach, describe, expect, it, vi } from "vitest";
import {
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
