import { describe, expect, it } from "vitest";
import { cacheOfflineShell } from "./offline-shell-cache";

function fakeCaches(failPutFor?: string) {
  const stores = new Map<string, Map<string, Response>>();
  const caches = {
    open: async (name: string) => {
      const store = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, store);
      return {
        put: async (key: string, response: Response) => {
          if (key === failPutFor) throw new Error("quota");
          store.set(key, response);
        },
      };
    },
  } as unknown as CacheStorage;
  return { caches, stores };
}

const ASSETS = ["/_next/static/chunks/a.js", "/_next/static/chunks/lazy.js"];

function env(overrides: Partial<Parameters<typeof cacheOfflineShell>[0]> & { missing?: string }) {
  const { caches, stores } = fakeCaches();
  const requested: string[] = [];
  return {
    stores,
    requested,
    env: {
      fetch: async (input: string) => {
        requested.push(input);
        return input === overrides.missing
          ? new Response("no", { status: 404 })
          : new Response(input);
      },
      caches,
      cacheName: "shell-v",
      shellPath: "/offline-manifest",
      assets: ASSETS,
      ...overrides,
    },
  };
}

describe("cacheOfflineShell", () => {
  it("caches the shell and exactly the listed assets, without reading the shell's HTML", async () => {
    const { env: e, stores, requested } = env({});
    await cacheOfflineShell(e);
    expect([...(stores.get("shell-v")?.keys() ?? [])].sort()).toEqual(
      ["/offline-manifest", ...ASSETS].sort(),
    );
    expect(requested.sort()).toEqual(["/offline-manifest", ...ASSETS].sort());
  });

  it("writes nothing when any listed asset fails to load", async () => {
    const { env: e, stores } = env({ missing: ASSETS[1] });
    await expect(cacheOfflineShell(e)).rejects.toThrow(/lazy\.js could not be loaded/);
    expect(stores.size).toBe(0);
  });

  it("writes nothing when the shell itself fails to load", async () => {
    const { env: e, stores } = env({ missing: "/offline-manifest" });
    await expect(cacheOfflineShell(e)).rejects.toThrow(/shell could not be loaded/);
    expect(stores.size).toBe(0);
  });

  it("writes the shell last, so a failed asset write leaves the previous shell in place", async () => {
    const { caches, stores } = fakeCaches(ASSETS[0]);
    const { env: e } = env({});
    await expect(cacheOfflineShell({ ...e, caches })).rejects.toThrow("quota");
    expect(stores.get("shell-v")?.has("/offline-manifest")).toBe(false);
  });

  it("precaches only the shell when no build produced an asset list (dev)", async () => {
    const { env: e, stores } = env({ assets: null });
    await cacheOfflineShell(e);
    expect([...(stores.get("shell-v")?.keys() ?? [])]).toEqual(["/offline-manifest"]);
  });
});
