// Exercise the real worker fetch listener in a worker-shaped environment.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/offline-manifest-store", () => ({
  listOfflineManifests: vi.fn(),
  purgeOfflineManifestsExceptShop: vi.fn(),
  saveOfflineManifest: vi.fn(),
  syncOfflineManifest: vi.fn(),
  wipeOfflineMedicalAlerts: vi.fn(),
}));

const listeners = new Map<string, (event: unknown) => void>();
const fetchMock = vi.fn<(input: unknown, init?: unknown) => Promise<Response>>();
const scope = {
  addEventListener: (type: string, listener: (event: unknown) => void) => {
    listeners.set(type, listener);
  },
  registration: { scope: "https://dive.day/" },
  location: new URL("https://dive.day/"),
};

beforeAll(async () => {
  vi.stubGlobal("self", scope);
  await import("./manifest-sw");
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("self", scope);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("static chunk caching", () => {
  const url = "https://dive.day/_next/static/chunks/src_error.js";
  let cached: Response | undefined;
  const put = vi.fn();
  const remove = vi.fn();

  beforeEach(() => {
    cached = undefined;
    put.mockResolvedValue(undefined);
    remove.mockResolvedValue(true);
    vi.stubGlobal("caches", {
      match: async () => cached?.clone(),
      open: async () => ({ put, delete: remove }),
    });
  });

  function load() {
    let response: Promise<Response> | undefined;
    listeners.get("fetch")?.({
      request: new Request(url),
      respondWith: (result: Promise<Response>) => {
        response = result;
      },
    });
    if (!response) throw new Error("worker did not handle the static chunk");
    return response;
  }

  it("replaces a cached mutable dev chunk with the current network response", async () => {
    cached = new Response("old Next runtime", { headers: { "cache-control": "no-store" } });
    fetchMock.mockResolvedValue(
      new Response("current Next runtime", { headers: { "cache-control": "no-store" } }),
    );

    expect(await (await load()).text()).toBe("current Next runtime");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(put).not.toHaveBeenCalled();
  });

  it("keeps an immutable production chunk available without a network", async () => {
    cached = new Response("production runtime", {
      headers: { "cache-control": "public, max-age=31536000, immutable" },
    });
    fetchMock.mockRejectedValue(new Error("offline"));

    expect(await (await load()).text()).toBe("production runtime");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stores a successful immutable production response", async () => {
    fetchMock.mockResolvedValue(
      new Response("production runtime", {
        headers: { "cache-control": "public, max-age=31536000, immutable" },
      }),
    );

    expect(await (await load()).text()).toBe("production runtime");
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("does not store a mutable dev response or reuse an unversioned cached response", async () => {
    cached = new Response("old runtime");
    fetchMock.mockResolvedValue(
      new Response("new runtime", { headers: { "cache-control": "no-cache, must-revalidate" } }),
    );

    expect(await (await load()).text()).toBe("new runtime");
    expect(put).not.toHaveBeenCalled();
  });

  it.each(["no-store", "public, immutable, no-store", ""])(
    "does not store a response with cache-control %j",
    async (cacheControl) => {
      fetchMock.mockResolvedValue(
        new Response("current runtime", { headers: { "cache-control": cacheControl } }),
      );

      expect(await (await load()).text()).toBe("current runtime");
      expect(put).not.toHaveBeenCalled();
    },
  );

  it("does not store a failed response even when marked immutable", async () => {
    fetchMock.mockResolvedValue(
      new Response("missing chunk", { status: 404, headers: { "cache-control": "immutable" } }),
    );

    expect((await load()).status).toBe(404);
    expect(put).not.toHaveBeenCalled();
  });

  it("still serves the network response when deleting an old dev copy fails", async () => {
    cached = new Response("old runtime");
    remove.mockRejectedValue(new Error("storage unavailable"));
    fetchMock.mockResolvedValue(new Response("current runtime"));

    expect(await (await load()).text()).toBe("current runtime");
  });

  it("still serves an immutable network response when the cache is full", async () => {
    put.mockRejectedValue(new Error("quota exceeded"));
    fetchMock.mockResolvedValue(
      new Response("production runtime", { headers: { "cache-control": "immutable" } }),
    );

    expect(await (await load()).text()).toBe("production runtime");
  });
});
