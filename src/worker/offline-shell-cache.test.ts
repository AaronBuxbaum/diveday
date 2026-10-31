import { describe, expect, it } from "vitest";
import { cacheOfflineShell, shellBuildId } from "./offline-shell-cache";

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

const BUILD = { id: "build-1", assets: ASSETS };
const shellHtml = (id: string | null) =>
  `<!doctype html><html><head>${id ? `<meta name="diveday-build" content="${id}">` : ""}</head></html>`;

function env(
  overrides: Partial<Parameters<typeof cacheOfflineShell>[0]> & {
    missing?: string;
    /** The build id the network's shell HTML names. */
    served?: string | null;
  },
) {
  const { caches, stores } = fakeCaches();
  const served = overrides.served === undefined ? "build-1" : overrides.served;
  const requested: string[] = [];
  return {
    stores,
    requested,
    env: {
      fetch: async (input: string) => {
        requested.push(input);
        if (input === overrides.missing) return new Response("no", { status: 404 });
        return new Response(input === "/offline-manifest" ? shellHtml(served) : input);
      },
      caches,
      cacheName: "shell-v",
      shellPath: "/offline-manifest",
      build: BUILD,
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
    const { env: e, stores } = env({ build: null, served: null });
    await cacheOfflineShell(e);
    expect([...(stores.get("shell-v")?.keys() ?? [])]).toEqual(["/offline-manifest"]);
  });

  it("rejects the install, writing nothing, when the shell is another build than the list", async () => {
    const { env: e, stores } = env({ served: "build-2" });
    await expect(cacheOfflineShell(e)).rejects.toThrow(
      /build build-2, not this worker's build build-1/,
    );
    expect(stores.size).toBe(0);
  });

  it("rejects a shell that names no build at all", async () => {
    const { env: e, stores } = env({ served: null });
    await expect(cacheOfflineShell(e)).rejects.toThrow(/build unknown/);
    expect(stores.size).toBe(0);
  });

  it("fetches assets past the HTTP cache so an old immutable chunk cannot answer", async () => {
    const inits: (RequestInit | undefined)[] = [];
    const { env: e } = env({});
    const inner = e.fetch;
    await cacheOfflineShell({
      ...e,
      fetch: (input, init) => {
        if (input !== "/offline-manifest") inits.push(init);
        return inner(input);
      },
    });
    expect(inits).toHaveLength(ASSETS.length);
    for (const init of inits) expect(init?.cache).toBe("reload");
  });
});

describe("shellBuildId", () => {
  it("reads the meta whichever way round its attributes are", () => {
    expect(shellBuildId('<meta content="b-9" name="diveday-build">')).toBe("b-9");
    expect(shellBuildId('<meta name="diveday-build" content="b-9"/>')).toBe("b-9");
    expect(shellBuildId("<html></html>")).toBeNull();
  });
});
