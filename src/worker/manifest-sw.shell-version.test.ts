// Run with a worker-like global, without a DOM.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_MANIFEST_SHELL_VERSION } from "@/lib/offline-manifests";

const listeners = new Map<string, (event: unknown) => void>();
const scope = {
  addEventListener: (type: string, listener: (event: unknown) => void) =>
    listeners.set(type, listener),
  clients: { claim: async () => {}, matchAll: async () => [] },
  registration: { showNotification: async () => {}, scope: "https://dive.day/" },
  skipWaiting: () => {},
  location: new URL("https://dive.day/"),
};
beforeAll(async () => {
  vi.stubGlobal("self", scope);
  vi.stubGlobal("navigator", { onLine: true });
  await import("./manifest-sw");
});
beforeEach(() => {
  scope.clients.claim = async () => {};
});

describe("offline shell versioning", () => {
  it("reports the shared shell version to clients", () => {
    const postMessage = vi.fn();
    const handler = listeners.get("message");
    if (!handler) throw new Error("the worker registered no message listener");

    handler({
      data: { type: "GET_SHELL_VERSION" },
      ports: [{ postMessage }],
    });

    expect(postMessage).toHaveBeenCalledWith({ version: OFFLINE_MANIFEST_SHELL_VERSION });
  });

  it("keeps the versioned shell cache and removes older shell caches on activation", async () => {
    const currentCache = `diveday-offline-manifest-shell-${OFFLINE_MANIFEST_SHELL_VERSION}`;
    const previousShellVersion = Number(OFFLINE_MANIFEST_SHELL_VERSION.slice(1)) - 1;
    const oldCache = `diveday-offline-manifest-shell-v${previousShellVersion}`;
    const unrelatedCache = "diveday-ready-pages-v1";
    const deleted: string[] = [];
    vi.stubGlobal("caches", {
      keys: async () => [oldCache, currentCache, unrelatedCache],
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    });
    const handler = listeners.get("activate");
    if (!handler) throw new Error("the worker registered no activate listener");
    const waits: Promise<unknown>[] = [];

    handler({ waitUntil: (promise: Promise<unknown>) => waits.push(promise) });
    await Promise.all(waits);

    expect(deleted).toEqual([oldCache]);
  });

  it("holds activation until the old shell caches are gone even when another step fails", async () => {
    const currentCache = `diveday-offline-manifest-shell-${OFFLINE_MANIFEST_SHELL_VERSION}`;
    const oldCache = "diveday-offline-manifest-shell-v0";
    const deleted: string[] = [];
    vi.stubGlobal("caches", {
      // Listing fails at once: the first step to settle, and a rejection.
      keys: async () => {
        throw new Error("storage unavailable");
      },
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    });
    const handler = listeners.get("activate");
    if (!handler) throw new Error("the worker registered no activate listener");
    const waits: Promise<unknown>[] = [];
    handler({ waitUntil: (promise: Promise<unknown>) => waits.push(promise) });
    // keys() throws, so nothing could be listed: the activation reports it
    // rather than swallowing it, after every step has finished.
    await expect(Promise.all(waits)).rejects.toThrow("storage unavailable");
    expect(deleted).toEqual([]);

    // And a slow deletion is waited for, not raced, when the claim fails first.
    let finishDelete: () => void = () => {};
    const slowDelete = new Promise<void>((resolve) => {
      finishDelete = resolve;
    });
    vi.stubGlobal("caches", {
      keys: async () => [oldCache, currentCache],
      delete: async (name: string) => {
        await slowDelete;
        deleted.push(name);
        return true;
      },
    });
    scope.clients.claim = async () => {
      throw new Error("claim failed");
    };
    const lateWaits: Promise<unknown>[] = [];
    handler({ waitUntil: (promise: Promise<unknown>) => lateWaits.push(promise) });
    let settled = false;
    const activation = Promise.allSettled(lateWaits).then(() => {
      settled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    finishDelete();
    await activation;
    scope.clients.claim = async () => {};
    expect(deleted).toEqual([oldCache]);
  });

  it("removes shell caches left by earlier builds of the same version", async () => {
    const currentCache = `diveday-offline-manifest-shell-${OFFLINE_MANIFEST_SHELL_VERSION}`;
    const deleted: string[] = [];
    vi.stubGlobal("caches", {
      keys: async () => [`${currentCache}-build-old`, currentCache],
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    });
    const handler = listeners.get("activate");
    if (!handler) throw new Error("the worker registered no activate listener");
    const waits: Promise<unknown>[] = [];
    handler({ waitUntil: (promise: Promise<unknown>) => waits.push(promise) });
    await Promise.all(waits);
    // The test worker has no build list, so its cache carries no build id.
    expect(deleted).toEqual([`${currentCache}-build-old`]);
  });
});
