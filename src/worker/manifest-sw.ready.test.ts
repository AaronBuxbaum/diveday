// The real worker event surface in a node environment, isolated to diver readiness copies.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { READY_CACHE_NAME } from "@/lib/ready-offline";
import { advanceClock } from "@/test/clock";
import { snapshotOf } from "./ready-test-support";

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
  addEventListener: (type: string, listener: (event: unknown) => void) =>
    listeners.set(type, listener),
  registration: { scope: "https://dive.day/" },
  location: new URL("https://dive.day/"),
};
function installGlobals() {
  vi.stubGlobal("self", scope);
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("fetch", fetchMock);
}
beforeAll(async () => {
  installGlobals();
  await import("./manifest-sw");
});
beforeEach(() => {
  vi.resetAllMocks();
  installGlobals();
});

/**
 * The diver's trip-prep page, kept on their phone (`ready-page-cache.ts`).
 * The same script registered twice: under `/ready/` it keeps the page; under
 * `/` (the staff worker, on a shared shop tablet) it never does.
 */
describe("the /ready/ registration's fetch", () => {
  const TOKEN = "Z".repeat(43);
  const PATH = `/ready/${TOKEN}`;
  const kept = new Map<string, Response>();
  const cacheStub = {
    keys: async () => [...kept.keys()].map((path) => new Request(`https://dive.day${path}`)),
    delete: async (key: string | Request) =>
      kept.delete(new URL(typeof key === "string" ? key : key.url, "https://dive.day").pathname),
    put: async (key: string | Request, response: Response) => {
      kept.set(
        new URL(typeof key === "string" ? key : key.url, "https://dive.day").pathname,
        response,
      );
    },
    match: async (key: string | Request) =>
      kept
        .get(new URL(typeof key === "string" ? key : key.url, "https://dive.day").pathname)
        ?.clone(),
  };

  function navigate(url: string) {
    const handler = listeners.get("fetch");
    if (!handler) throw new Error("no fetch listener");
    let responded: Promise<Response> | undefined;
    const waits: Promise<unknown>[] = [];
    handler({
      request: { url, method: "GET", mode: "navigate" },
      respondWith: (promise: Promise<Response>) => {
        responded = promise;
      },
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    });
    return { responded, settle: async () => Promise.allSettled([responded, ...waits]) };
  }

  /**
   * What the server will answer each `/ready/<token>/offline` request, in the
   * order the worker asks. The worker keeps the snapshot, never the page, so a
   * live page here only has to exist; its snapshot is queued beside it.
   */
  const snapshotReplies: Array<() => Response | Promise<Response>> = [];
  const snapshotAsked: string[] = [];
  const router = async (input: unknown, init?: unknown) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (!url.endsWith("/offline")) return fetchMock(input, init);
    snapshotAsked.push(url);
    const reply = snapshotReplies.shift();
    return reply ? reply() : new Response("no reply queued", { status: 500 });
  };
  const livePage = (body: string) =>
    new Response(`<p>${body}</p>`, { status: 200, headers: { "content-type": "text/html" } });
  /** A live page whose snapshot says `body`. */
  const html = (body: string) => {
    snapshotReplies.push(() => Response.json(snapshotOf(body, { generatedAt: Date.now() })));
    return livePage(body);
  };
  /** A live page the server then refuses a snapshot for (cancelled, called off, dead link). */
  const terminalPage = (body = "This link no longer works") => {
    snapshotReplies.push(() => new Response("Not found", { status: 404 }));
    return livePage(body);
  };
  /** A live page whose snapshot cannot be fetched. */
  const unsnapshotted = (body: string) => {
    snapshotReplies.push(() => {
      throw new TypeError("snapshot unavailable");
    });
    return livePage(body);
  };
  /** Holds the next snapshot until `release` is called with what the server then says. */
  const heldSnapshot = () => {
    const held: { release?: (reply: Response) => void } = {};
    snapshotReplies.push(
      () =>
        new Promise<Response>((resolve) => {
          held.release = resolve;
        }),
    );
    return held;
  };

  /** Every other cache the worker opens here (the forget markers), kept apart from the copy. */
  const others = new Map<string, Response>();
  let failMarkerWrites = false;
  const otherStub = {
    keys: async () => [...others.keys()].map((path) => new Request(`https://dive.day${path}`)),
    delete: async (key: string | Request) =>
      others.delete(new URL(typeof key === "string" ? key : key.url, "https://dive.day").pathname),
    put: async (key: string | Request, response: Response) => {
      if (failMarkerWrites) throw new Error("quota exceeded");
      others.set(
        new URL(typeof key === "string" ? key : key.url, "https://dive.day").pathname,
        response,
      );
    },
    match: async (key: string | Request) =>
      others
        .get(new URL(typeof key === "string" ? key : key.url, "https://dive.day").pathname)
        ?.clone(),
  };

  function message(type: string, sourceUrl: string) {
    const handler = listeners.get("message");
    if (!handler) throw new Error("no message listener");
    const replies: unknown[] = [];
    const waits: Promise<unknown>[] = [];
    handler({
      data: { type },
      ports: [{ postMessage: (reply: unknown) => replies.push(reply) }],
      source: { url: sourceUrl },
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    });
    return { replies, settle: () => Promise.allSettled(waits) };
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", router);
    snapshotReplies.length = 0;
    snapshotAsked.length = 0;
    kept.clear();
    others.clear();
    failMarkerWrites = false;
    vi.stubGlobal("caches", {
      open: async (name: string) => (name === READY_CACHE_NAME ? cacheStub : otherStub),
      match: async (key: string | Request) => (await cacheStub.match(key)) ?? otherStub.match(key),
      delete: async (name: string) => (name === READY_CACHE_NAME ? kept.clear() : others.clear()),
    });
    scope.registration.scope = "https://dive.day/ready/";
  });

  afterEach(() => {
    scope.registration.scope = "https://dive.day/";
  });

  it("publishes no saved document before the snapshot arrives", async () => {
    fetchMock.mockResolvedValueOnce(livePage("live"));
    const snapshot = heldSnapshot();
    const keep = message("KEEP_READY_PAGE", `https://dive.day${PATH}`);
    try {
      await vi.waitFor(() => expect(snapshot.release).toBeDefined());
      expect(snapshotAsked).toEqual([`${PATH}/offline`]);
      expect(kept.size).toBe(0);
      expect(keep.replies).toEqual([]);
    } finally {
      snapshot.release?.(Response.json(snapshotOf("held")));
      await keep.settle();
    }
    expect(kept.size).toBe(1);
    expect(keep.replies).toEqual([{ ok: true }]);
  });

  it("refuses a new saved copy when the snapshot cannot be fetched", async () => {
    fetchMock.mockResolvedValueOnce(unsnapshotted("live"));
    const keep = message("KEEP_READY_PAGE", `https://dive.day${PATH}`);
    await keep.settle();
    expect(kept.size).toBe(0);
    expect(keep.replies).toEqual([{ ok: false }]);
  });

  it("preserves the previous complete copy when the new snapshot fails", async () => {
    fetchMock.mockResolvedValueOnce(html("previous complete page"));
    const previous = navigate(`https://dive.day${PATH}`);
    await previous.responded;
    await previous.settle();
    fetchMock.mockResolvedValueOnce(unsnapshotted("new incomplete page"));
    const keep = message("KEEP_READY_PAGE", `https://dive.day${PATH}`);
    await keep.settle();
    expect(keep.replies).toEqual([{ ok: false }]);
    expect(await [...kept.values()][0].clone().text()).toContain("previous complete page");
    expect(await [...kept.values()][0].clone().text()).not.toContain("new incomplete page");
  });

  it("keeps the snapshot for navigation saves too, and nothing of the page", async () => {
    fetchMock.mockResolvedValueOnce(html("where to go"));
    const navigation = navigate(`https://dive.day${PATH}`);
    expect(await (await navigation.responded)?.text()).toContain("<p>where to go</p>");
    await navigation.settle();
    expect(kept.size).toBe(1);
    expect(snapshotAsked).toEqual([`${PATH}/offline`]);
  });

  it("publishes nothing if the copy is forgotten while the snapshot is loading", async () => {
    fetchMock.mockResolvedValueOnce(livePage("live"));
    const snapshot = heldSnapshot();
    const put = vi.spyOn(cacheStub, "put");
    const keep = message("KEEP_READY_PAGE", `https://dive.day${PATH}`);
    try {
      await vi.waitFor(() => expect(snapshot.release).toBeDefined());
      await message("FORGET_READY_PAGE", `https://dive.day${PATH}?cancelled=1`).settle();
      snapshot.release?.(Response.json(snapshotOf("pre-cancel")));
      await keep.settle();
      expect(put).not.toHaveBeenCalled();
      expect(kept.size).toBe(0);
      expect(keep.replies).toEqual([{ ok: false }]);
    } finally {
      snapshot.release?.(Response.json(snapshotOf("pre-cancel")));
      await keep.settle();
      put.mockRestore();
    }
  });

  it.each(["terminal", "expired"] as const)(
    "does not resurrect a copy after a newer %s snapshot",
    async (state) => {
      fetchMock.mockResolvedValueOnce(livePage("live"));
      const older = heldSnapshot();
      const keep = message("KEEP_READY_PAGE", `https://dive.day${PATH}`);
      try {
        await vi.waitFor(() => expect(older.release).toBeDefined());
        if (state === "terminal") {
          fetchMock.mockResolvedValueOnce(terminalPage());
        } else {
          fetchMock.mockResolvedValueOnce(livePage("expired"));
          snapshotReplies.push(() =>
            Response.json(snapshotOf("expired", { generatedAt: Date.now(), keepUntil: 1 })),
          );
        }
        const terminal = message("KEEP_READY_PAGE", `https://dive.day${PATH}`);
        await terminal.settle();
        expect(terminal.replies).toEqual([{ ok: false }]);
        older.release?.(Response.json(snapshotOf("older")));
        await keep.settle();
        expect(keep.replies).toEqual([{ ok: false }]);
        expect(kept.size).toBe(0);
      } finally {
        older.release?.(Response.json(snapshotOf("older")));
        await keep.settle();
      }
    },
  );

  it("serves immutable cached font bytes offline and refuses a mutable cached font", async () => {
    const asset = "/_next/static/media/plex.woff2";
    others.set(
      asset,
      new Response("font bytes", {
        headers: { "cache-control": "public, max-age=31536000, immutable" },
      }),
    );
    fetchMock.mockRejectedValue(new TypeError("offline"));
    const requestFont = () => {
      let response: Promise<Response> | undefined;
      listeners.get("fetch")?.({
        request: { url: `https://dive.day${asset}`, method: "GET", mode: "cors" },
        respondWith: (pending: Promise<Response>) => {
          response = pending;
        },
      });
      return response;
    };
    expect(await (await requestFont())?.text()).toBe("font bytes");
    expect(fetchMock).not.toHaveBeenCalled();
    others.set(asset, new Response("mutable font", { headers: { "cache-control": "no-store" } }));
    await expect(requestFont()).rejects.toThrow("offline");
    expect(others.has(asset)).toBe(false);
  });

  it.each([false, true])(
    "does not replace a newer valid copy after an old snapshot finishes, different path=%s",
    async (differentPath) => {
      const newerPath = differentPath ? `/ready/${"Y".repeat(43)}` : PATH;
      fetchMock.mockResolvedValue(livePage("live"));
      const olderSnapshot = heldSnapshot();
      const older = message("KEEP_READY_PAGE", `https://dive.day${PATH}`);
      try {
        await vi.waitFor(() => expect(olderSnapshot.release).toBeDefined());
        snapshotReplies.push(() => Response.json(snapshotOf("new meeting point")));
        const newer = message("KEEP_READY_PAGE", `https://dive.day${newerPath}`);
        await newer.settle();
        expect(newer.replies).toEqual([{ ok: true }]);
        olderSnapshot.release?.(Response.json(snapshotOf("old meeting point")));
        await older.settle();
        expect(older.replies).toEqual([{ ok: false }]);
        expect(await [...kept.values()][0].clone().text()).toContain("new meeting point");
        expect(await [...kept.values()][0].clone().text()).not.toContain("old meeting point");
      } finally {
        olderSnapshot.release?.(Response.json(snapshotOf("old meeting point")));
        await older.settle();
      }
    },
  );

  it.each(["valid", "terminal"] as const)(
    "ignores an older %s response arriving after a newer different page",
    async (state) => {
      let answerOlder: ((response: Response) => void) | undefined;
      fetchMock.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            answerOlder = resolve;
          }),
      );
      const older = message("KEEP_READY_PAGE", `https://dive.day${PATH}`);
      const newerPath = `/ready/${"Y".repeat(43)}`;
      fetchMock.mockResolvedValueOnce(html("new meeting point"));
      const newer = message("KEEP_READY_PAGE", `https://dive.day${newerPath}`);
      await newer.settle();
      expect(newer.replies).toEqual([{ ok: true }]);
      answerOlder?.(state === "valid" ? html("old meeting point") : terminalPage());
      await older.settle();
      expect(older.replies).toEqual([{ ok: false }]);
      expect(await [...kept.values()][0].clone().text()).toContain("new meeting point");
    },
  );

  it("serializes publication when a newer request starts during an older cache put", async () => {
    let finishPut: (() => void) | undefined;
    const originalPut = cacheStub.put.bind(cacheStub);
    let first = true;
    const put = vi.spyOn(cacheStub, "put").mockImplementation(async (key, response) => {
      if (first) {
        first = false;
        await new Promise<void>((resolve) => {
          finishPut = resolve;
        });
      }
      await originalPut(key, response);
    });
    fetchMock
      .mockResolvedValueOnce(html("old meeting point"))
      .mockResolvedValueOnce(html("new meeting point"));
    const older = message("KEEP_READY_PAGE", `https://dive.day${PATH}`);
    try {
      await vi.waitFor(() => expect(finishPut).toBeDefined());
      const newer = message("KEEP_READY_PAGE", `https://dive.day${PATH}`);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(put).toHaveBeenCalledTimes(1);
      finishPut?.();
      await Promise.all([older.settle(), newer.settle()]);
      expect(older.replies).toEqual([{ ok: false }]);
      expect(newer.replies).toEqual([{ ok: true }]);
      expect(await [...kept.values()][0].clone().text()).toContain("new meeting point");
    } finally {
      finishPut?.();
      await older.settle();
      put.mockRestore();
    }
  });

  it("keeps a complete copy when a newer snapshot fetch fails during an older put", async () => {
    fetchMock.mockResolvedValueOnce(html("complete C"));
    await message("KEEP_READY_PAGE", `https://dive.day${PATH}`).settle();
    let finishPut: (() => void) | undefined;
    const originalPut = cacheStub.put.bind(cacheStub);
    let first = true;
    const put = vi.spyOn(cacheStub, "put").mockImplementation(async (key, response) => {
      if (first) {
        first = false;
        await new Promise<void>((resolve) => {
          finishPut = resolve;
        });
      }
      await originalPut(key, response);
    });
    fetchMock.mockResolvedValueOnce(html("complete A"));
    const older = message("KEEP_READY_PAGE", `https://dive.day${PATH}`);
    try {
      await vi.waitFor(() => expect(finishPut).toBeDefined());
      fetchMock.mockResolvedValueOnce(unsnapshotted("incomplete B"));
      const newer = message("KEEP_READY_PAGE", `https://dive.day${PATH}`);
      // The newer save labels the held copy stale through the same publication
      // queue the older put holds, so it can only finish once that put does.
      await vi.waitFor(() => expect(snapshotAsked).toHaveLength(3));
      finishPut?.();
      await Promise.all([older.settle(), newer.settle()]);
      expect(newer.replies).toEqual([{ ok: false }]);
      expect(older.replies).toEqual([{ ok: false }]);
      fetchMock.mockRejectedValue(new TypeError("offline"));
      const offline = navigate(`https://dive.day${PATH}`);
      expect(await (await offline.responded)?.text()).toContain("complete A");
    } finally {
      finishPut?.();
      await older.settle();
      put.mockRestore();
    }
  });

  it("still removes a complete copy when explicitly forgotten during its put", async () => {
    let finishPut: (() => void) | undefined;
    const originalPut = cacheStub.put.bind(cacheStub);
    const put = vi.spyOn(cacheStub, "put").mockImplementation(async (key, response) => {
      await new Promise<void>((resolve) => {
        finishPut = resolve;
      });
      await originalPut(key, response);
    });
    fetchMock.mockResolvedValueOnce(html("complete A"));
    const keep = message("KEEP_READY_PAGE", `https://dive.day${PATH}`);
    try {
      await vi.waitFor(() => expect(finishPut).toBeDefined());
      const forget = message("FORGET_READY_PAGE", `https://dive.day${PATH}?cancelled=1`);
      const forgetting = forget.settle();
      finishPut?.();
      await forgetting;
      await keep.settle();
      expect(forget.replies).toEqual([{ ok: true }]);
      expect(keep.replies).toEqual([{ ok: false }]);
      expect(kept.size).toBe(0);
    } finally {
      finishPut?.();
      await keep.settle();
      put.mockRestore();
    }
  });

  it.each([false, true])(
    "forgets an observed terminal page even after a newer same-path request, newer snapshot fails=%s",
    async (snapshotFails) => {
      fetchMock.mockResolvedValueOnce(html("complete P"));
      await message("KEEP_READY_PAGE", `https://dive.day${PATH}`).settle();
      fetchMock.mockResolvedValueOnce(livePage("older"));
      const olderSnapshot = heldSnapshot();
      const older = message("KEEP_READY_PAGE", `https://dive.day${PATH}`);
      await vi.waitFor(() => expect(olderSnapshot.release).toBeDefined());
      fetchMock.mockResolvedValueOnce(
        snapshotFails ? unsnapshotted("incomplete B") : html("complete B"),
      );
      const newer = message("KEEP_READY_PAGE", `https://dive.day${PATH}`);
      await newer.settle();
      expect(newer.replies).toEqual([{ ok: !snapshotFails }]);
      olderSnapshot.release?.(new Response("Not found", { status: 404 }));
      await older.settle();
      expect(older.replies).toEqual([{ ok: false }]);
      expect(kept.size).toBe(0);
    },
  );

  it("dates terminal observation after its delayed answer, invalidating a newer pending save", async () => {
    fetchMock.mockResolvedValueOnce(html("complete P"));
    await message("KEEP_READY_PAGE", `https://dive.day${PATH}`).settle();
    fetchMock.mockResolvedValueOnce(livePage("terminal"));
    const terminalSnapshot = heldSnapshot();
    const terminal = message("KEEP_READY_PAGE", `https://dive.day${PATH}`);
    let newer: ReturnType<typeof message> | undefined;
    const newerSnapshot = heldSnapshot();
    try {
      await vi.waitFor(() => expect(terminalSnapshot.release).toBeDefined());
      advanceClock();
      fetchMock.mockResolvedValueOnce(livePage("new pending page"));
      newer = message("KEEP_READY_PAGE", `https://dive.day${PATH}`);
      await vi.waitFor(() => expect(newerSnapshot.release).toBeDefined());
      advanceClock();
      terminalSnapshot.release?.(new Response("Not found", { status: 404 }));
      await terminal.settle();
      advanceClock();
      newerSnapshot.release?.(Response.json(snapshotOf("new pending page")));
      await newer.settle();
      expect(terminal.replies).toEqual([{ ok: false }]);
      expect(newer.replies).toEqual([{ ok: false }]);
      expect(kept.size).toBe(0);
    } finally {
      terminalSnapshot.release?.(new Response("Not found", { status: 404 }));
      newerSnapshot.release?.(Response.json(snapshotOf("new pending page")));
      await terminal.settle();
      await newer?.settle();
    }
  });

  it("keeps the live page on the way through, and serves it when the network fails", async () => {
    fetchMock.mockResolvedValueOnce(html("live"));
    const online = navigate(`https://dive.day${PATH}`);
    expect(await (await online.responded)?.text()).toContain("live");
    await online.settle();
    expect(kept.size).toBe(1);

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const offline = navigate(`https://dive.day${PATH}`);
    expect(await (await offline.responded)?.text()).toContain("live");
  });

  it("serves the live page when request-marker storage fails and never saves that response", async () => {
    failMarkerWrites = true;
    fetchMock.mockResolvedValueOnce(html("live without marker"));

    const online = navigate(`https://dive.day${PATH}`);
    expect(await (await online.responded)?.text()).toContain("live without marker");
    await online.settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(kept.size).toBe(0);
  });

  it("uses an existing saved copy on network failure when request-marker storage fails", async () => {
    fetchMock.mockResolvedValueOnce(html("previous saved copy"));
    const initial = navigate(`https://dive.day${PATH}`);
    await initial.responded;
    await initial.settle();
    expect(kept.size).toBe(1);

    failMarkerWrites = true;
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    const offline = navigate(`https://dive.day${PATH}`);
    expect(await (await offline.responded)?.text()).toContain("previous saved copy");
    await offline.settle();
  });

  it("returns the network error rather than a copy when none exists and marker storage fails", async () => {
    failMarkerWrites = true;
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    const offline = navigate(`https://dive.day${PATH}`);
    expect((await offline.responded)?.type).toBe("error");
    await offline.settle();
  });

  it("clears a matching stale copy when a live terminal response arrives despite marker failure", async () => {
    fetchMock.mockResolvedValueOnce(html("previous saved copy"));
    const initial = navigate(`https://dive.day${PATH}`);
    await initial.responded;
    await initial.settle();
    expect(kept.size).toBe(1);

    failMarkerWrites = true;
    fetchMock.mockResolvedValueOnce(terminalPage("This booking is no longer active"));
    const terminal = navigate(`https://dive.day${PATH}`);
    expect(await (await terminal.responded)?.text()).toContain("This booking is no longer active");
    await terminal.settle();

    expect(kept.size).toBe(0);
  });

  it("serves the kept copy within four seconds when the network never answers", async () => {
    fetchMock.mockResolvedValueOnce(html("live"));
    const online = navigate(`https://dive.day${PATH}`);
    await online.responded;
    await online.settle();
    expect(kept.size).toBe(1);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}));
      const dead = navigate(`https://dive.day${PATH}`);
      await vi.advanceTimersByTimeAsync(4_000);
      expect(await (await dead.responded)?.text()).toContain("live");
    } finally {
      vi.useRealTimers();
    }
  });

  /** Security review of layer 8, D2: a self-cancel lands here, and the copy goes with the seat. */
  it("forgets the copy when the page comes back cancelled", async () => {
    fetchMock.mockResolvedValueOnce(html("live"));
    const online = navigate(`https://dive.day${PATH}`);
    await online.responded;
    await online.settle();
    expect(kept.size).toBe(1);

    fetchMock.mockResolvedValueOnce(html("cancelled"));
    const cancelled = navigate(`https://dive.day${PATH}?cancelled=1`);
    await cancelled.responded;
    await cancelled.settle();
    expect(kept.size).toBe(0);
  });

  /**
   * Issue #2979: the load right after a cancel is the one the deadline must
   * not answer from the copy. Slow or dead, the pre-cancel page with its links
   * is never served, and the copy is gone before the network is asked.
   */
  it("forgets the copy and never serves it when a cancelled landing is slow", async () => {
    fetchMock.mockResolvedValueOnce(html("live"));
    const online = navigate(`https://dive.day${PATH}`);
    await online.responded;
    await online.settle();
    expect(kept.size).toBe(1);

    let served: Response | undefined;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}));
      const slow = navigate(`https://dive.day${PATH}?cancelled=1`);
      void slow.responded?.then((response) => {
        served = response;
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(served).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
    // The path's hash is worked out off the event loop the fake clock drives.
    await vi.waitFor(() => expect(kept.size).toBe(0));
    expect(served).toBeUndefined();

    // With no signal at all it is the ordinary offline error, not the old page.
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const failed = navigate(`https://dive.day${PATH}?cancelled=1`);
    expect((await failed.responded)?.type).toBe("error");
  });

  it("forgets the copy on a cancelled landing even when the network fails outright", async () => {
    fetchMock.mockResolvedValueOnce(html("live"));
    const online = navigate(`https://dive.day${PATH}`);
    await online.responded;
    await online.settle();
    expect(kept.size).toBe(1);

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const failed = navigate(`https://dive.day${PATH}?cancelled=1`);
    expect((await failed.responded)?.type).toBe("error");
    await failed.settle();
    expect(kept.size).toBe(0);
  });

  /** The landing's own keep request must not put back the copy its navigation just forgot. */
  it("keeps nothing when a cancelled landing asks to keep its page", async () => {
    const handler = listeners.get("message");
    if (!handler) throw new Error("no message listener");
    fetchMock.mockResolvedValueOnce(html("still live"));
    const replies: unknown[] = [];
    const waits: Promise<unknown>[] = [];
    handler({
      data: { type: "KEEP_READY_PAGE" },
      ports: [{ postMessage: (reply: unknown) => replies.push(reply) }],
      source: { url: `https://dive.day${PATH}?cancelled=1` },
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    });
    await Promise.allSettled(waits);
    expect(kept.size).toBe(0);
    expect(replies).toEqual([{ ok: false }]);
  });

  /**
   * Security review 2026-10-24 (#2979, finding 1): a self-cancel is a server
   * action whose redirect a hydrated page follows without a navigation, so the
   * worker's fetch listener never sees the `?cancelled=` landing. The landing
   * itself asks the worker to forget its copy.
   */
  it("forgets the copy when the cancelled landing asks", async () => {
    fetchMock.mockResolvedValueOnce(html("live"));
    const online = navigate(`https://dive.day${PATH}`);
    await online.responded;
    await online.settle();
    expect(kept.size).toBe(1);

    const forget = message("FORGET_READY_PAGE", `https://dive.day${PATH}?cancelled=1`);
    await forget.settle();
    expect(kept.size).toBe(0);
    expect(forget.replies).toEqual([{ ok: true }]);
  });

  it("does not acknowledge a cancelled landing when its invalidation marker cannot be stored", async () => {
    fetchMock.mockResolvedValueOnce(html("live"));
    const online = navigate(`https://dive.day${PATH}`);
    await online.responded;
    await online.settle();
    expect(kept.size).toBe(1);

    failMarkerWrites = true;
    const forget = message("FORGET_READY_PAGE", `https://dive.day${PATH}?cancelled=1`);
    await forget.settle();
    expect(kept.size).toBe(0);
    expect(forget.replies).toEqual([{ ok: false }]);
  });

  /** Finding 2: a keep request answered after the cancel brings back the pre-cancel page. */
  it("does not keep a page whose fetch began before the cancel", async () => {
    let answer: ((response: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    const keep = message("KEEP_READY_PAGE", `https://dive.day${PATH}`);
    await vi.waitFor(() => expect(answer).toBeDefined());
    const forget = message("FORGET_READY_PAGE", `https://dive.day${PATH}?cancelled=1`);
    await forget.settle();
    answer?.(html("before the cancel"));
    await keep.settle();
    expect(kept.size).toBe(0);
    expect(keep.replies).toEqual([{ ok: false }]);
  });

  it("rejects a pre-cancel response when the device clock moves backward", async () => {
    let answer: ((response: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    const staleResponse = html("before the cancel");
    const startedAt = Date.now() + 60_000;
    const deviceClock = vi.spyOn(Date, "now").mockReturnValue(startedAt);
    const keep = message("KEEP_READY_PAGE", `https://dive.day${PATH}`);
    try {
      await vi.waitFor(() => expect(answer).toBeDefined());
      deviceClock.mockReturnValue(startedAt - 60_000);
      const forget = message("FORGET_READY_PAGE", `https://dive.day${PATH}?cancelled=1`);
      await forget.settle();
      deviceClock.mockRestore();

      answer?.(staleResponse);
      await keep.settle();
      expect(kept.size).toBe(0);
      expect(keep.replies).toEqual([{ ok: false }]);
    } finally {
      deviceClock.mockRestore();
      answer?.(staleResponse);
      await keep.settle();
    }
  });

  it("does not keep a load that carries a one-time notice", async () => {
    fetchMock.mockResolvedValueOnce(html("with notice"));
    const load = navigate(`https://dive.day${PATH}?saved=seat`);
    await load.settle();
    expect(kept.size).toBe(0);
  });

  it("leaves every other navigation to the network", () => {
    expect(navigate("https://dive.day/shop/blue-mantis").responded).toBeUndefined();
    expect(navigate(`https://dive.day${PATH}/forms`).responded).toBeUndefined();
  });

  /**
   * The diver's registration never fetches the staff shell (issue #2693): a
   * page under `/ready/` that posts the staff worker's message gets a refusal,
   * and nothing is asked of the network.
   */
  it("refuses to cache the staff shell from the diver's registration", async () => {
    const handler = listeners.get("message");
    if (!handler) throw new Error("no message listener");
    const replies: unknown[] = [];
    const waits: Promise<unknown>[] = [];
    handler({
      data: { type: "CACHE_OFFLINE_MANIFEST_SHELL" },
      ports: [{ postMessage: (reply: unknown) => replies.push(reply) }],
      source: { url: `https://dive.day${PATH}` },
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    });
    await Promise.allSettled(waits);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(replies).toEqual([{ ok: false }]);
  });

  it("keeps nothing under the staff registration", async () => {
    scope.registration.scope = "https://dive.day/";
    const load = navigate(`https://dive.day${PATH}`);
    expect(load.responded).toBeUndefined();
    expect(kept.size).toBe(0);
  });
});
