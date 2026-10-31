import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { READY_CACHE_NAME, READY_FORGOTTEN_CACHE_NAME } from "@/lib/ready-offline";
import {
  beginReadyPageRequest,
  forgetReadyPage,
  readyPageFallback,
  saveReadyPage,
} from "./ready-page-cache";
import { livePage, NOW, page, stubSnapshotReply } from "./ready-test-support";

afterEach(() => {
  vi.unstubAllGlobals();
});

const ORIGIN = "https://dive.day";
const TOKEN = "A".repeat(43);
const OTHER = "B".repeat(43);

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
    stubSnapshotReply(new Response("Not found", { status: 404 }));
    const terminal = saveReadyPage(racing, path, livePage("Cancelled"), NOW, terminalRequest);
    await matchEntered;
    const newerRequest = beginReadyPageRequest(store.storage, otherPath);
    releaseMatch?.();

    expect(await terminal).toBe(false);
    const next = await newerRequest;
    expect(await saveReadyPage(store.storage, otherPath, page("new token"), NOW, next)).toBe(true);
    expect(await readyPageFallback(store.storage, otherPath, NOW)).toBeDefined();
  });
});
