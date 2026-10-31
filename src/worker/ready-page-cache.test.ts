// The default `node` environment, as the worker's own test: this module runs
// in a service worker, never in a DOM context.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { READY_CACHE_NAME, READY_FORGOTTEN_CACHE_NAME } from "@/lib/ready-offline";
import {
  beginReadyPageRequest,
  forgetReadyPage,
  isReadyScope,
  purgeLegacyReadyCopies,
  READY_COPY_KEY,
  READY_COPY_MAX_AGE_MS,
  readyPageFallback,
  readyPagePath,
  saveReadyPage,
} from "./ready-page-cache";
import { DAY_MS, livePage, NOW, page, snapshotOf, stubSnapshotReply } from "./ready-test-support";

const ORIGIN = "https://dive.day";
const TOKEN = "A".repeat(43);
const OTHER = "B".repeat(43);

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A Cache Storage with just the surface the module uses, keyed by path. */
function fakeStorage() {
  const caches = new Map<string, Map<string, Response>>();
  const pathOf = (key: string | Request) =>
    new URL(typeof key === "string" ? key : key.url, ORIGIN).pathname;
  const storage = {
    delete: async (name: string) => caches.delete(name),
    keys: async () => [...caches.keys()],
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
   * Two saves of the same page overlap (the navigation's and the page's own
   * keep request). A reload with no signal that lands between them must still
   * find a copy, so a save replaces the copy and never empties the cache first.
   */
  it("never leaves the cache without a copy while it replaces one", async () => {
    expect(await saveReadyPage(store.storage, `/ready/${TOKEN}`, page("first"), NOW)).toBe(true);
    const entries = store.caches.get(READY_CACHE_NAME);
    const sizes: number[] = [];
    const open = store.storage.open.bind(store.storage);
    const watched = {
      open: async (name: string) => {
        const cache = await open(name);
        return {
          ...cache,
          delete: async (key: RequestInfo | URL) => {
            const deleted = await cache.delete(key);
            sizes.push(entries?.size ?? 0);
            return deleted;
          },
        };
      },
    } as unknown as CacheStorage;
    expect(await saveReadyPage(watched, `/ready/${TOKEN}`, page("second"), NOW)).toBe(true);
    expect(sizes).not.toContain(0);
    const served = await readyPageFallback(store.storage, `/ready/${TOKEN}`, NOW);
    expect(await served?.text()).toContain("second");
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

  /**
   * **The stored bytes are the snapshot, never the page** (issue #3225). The
   * live page here carries every capability the old rewriter hunted for, and
   * none of it may reach Cache Storage or the document served from it.
   */
  it("stores the server's snapshot and nothing of the live page", async () => {
    const path = `/ready/${TOKEN}`;
    const claim = "C".repeat(43);
    const recap = `cmVjYXA6${"r".repeat(70)}.${"S".repeat(43)}`;
    const secrets = [
      TOKEN,
      claim,
      recap,
      "checkout.stripe.com",
      "$ACTION_",
      "__next_f",
      "<script",
      "main-app.js",
    ];
    const hostile = [
      `<a href="/ready/${TOKEN}/forms">Forms</a>`,
      `<a href="/claim/${claim}">Seat</a>`,
      `<a href="https://checkout.stripe.com/c/pay/cs_test_a1B2c3">Tip</a>`,
      `<input type="hidden" name="$ACTION_KEY" value="${recap}"/>`,
      `<script>self.__next_f.push([1,"${claim}"])</script>`,
      `<script src="/_next/static/chunks/main-app.js"></script>`,
    ].join("");
    const fetchMock = stubSnapshotReply(snapshotOf("<p>Where to go</p>"));
    expect(await saveReadyPage(store.storage, path, livePage(hostile), NOW)).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      `${path}/offline`,
      expect.objectContaining({ cache: "no-store", redirect: "error" }),
    );

    const kept = store.caches.get(READY_CACHE_NAME)?.values().next().value;
    const stored = (await kept?.clone().text()) ?? "";
    const headers = [...(kept?.headers.values() ?? [])].join(" ");
    const served = await readyPageFallback(store.storage, path, NOW + 1000);
    const text = (await served?.text()) ?? "";
    expect(text).toContain("Where to go");
    for (const secret of secrets) {
      expect(stored).not.toContain(secret);
      expect(headers).not.toContain(secret);
      expect(text).not.toContain(secret);
    }
    expect(await readyPageFallback(store.storage, `/ready/${OTHER}`, NOW + 1000)).toBeUndefined();
  });

  it("serves a document that can run nothing and reach nowhere", async () => {
    await saveReadyPage(store.storage, `/ready/${TOKEN}`, page(), NOW);
    const served = await readyPageFallback(store.storage, `/ready/${TOKEN}`, NOW + 1000);
    const policy = served?.headers.get("content-security-policy") ?? "";
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).not.toContain("script-src");
    expect(served?.headers.get("content-type")).toContain("text/html");
    expect(served?.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("clears the copy when the server says there is nothing to keep", async () => {
    const path = `/ready/${TOKEN}`;
    await saveReadyPage(store.storage, path, page(), NOW);
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(1);
    stubSnapshotReply(new Response("Not found", { status: 404 }));
    expect(await saveReadyPage(store.storage, path, livePage(), NOW)).toBe(false);
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(0);
    expect(await readyPageFallback(store.storage, path, NOW)).toBeUndefined();
  });

  it("clears the copy when the snapshot is already past its own date", async () => {
    const path = `/ready/${TOKEN}`;
    await saveReadyPage(store.storage, path, page(), NOW);
    stubSnapshotReply(snapshotOf("<p>x</p>", { keepUntil: NOW }));
    expect(await saveReadyPage(store.storage, path, livePage(), NOW)).toBe(false);
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(0);
  });

  it.each([
    ["a server error", () => new Response("boom", { status: 500 })],
    ["a throttle", () => new Response("slow down", { status: 429 })],
    ["not JSON", () => new Response("<p>html</p>", { headers: { "content-type": "text/html" } })],
    [
      "malformed JSON",
      () => new Response("{", { headers: { "content-type": "application/json" } }),
    ],
    [
      "a snapshot missing a document",
      () => Response.json({ generatedAt: NOW, keepUntil: NOW + DAY_MS, saved: "<p>x</p>" }),
    ],
    [
      "a snapshot with a fractional instant",
      () => Response.json({ ...snapshotOf(), generatedAt: NOW + 0.5 }),
    ],
  ])("keeps the previous copy when the snapshot answer is %s", async (_case, reply) => {
    const path = `/ready/${TOKEN}`;
    await saveReadyPage(store.storage, path, page("previous"), NOW);
    stubSnapshotReply(async () => reply());
    expect(await saveReadyPage(store.storage, path, livePage(), NOW)).toBe(false);
    expect(await (await readyPageFallback(store.storage, path, NOW))?.text()).toContain("previous");
  });

  it("keeps the previous copy when the snapshot cannot be fetched or is redirected", async () => {
    const path = `/ready/${TOKEN}`;
    await saveReadyPage(store.storage, path, page("previous"), NOW);
    stubSnapshotReply(async () => {
      throw new TypeError("redirect mode is error");
    });
    expect(await saveReadyPage(store.storage, path, livePage(), NOW)).toBe(false);
    const redirected = Response.json(snapshotOf("<p>elsewhere</p>"));
    Object.defineProperty(redirected, "redirected", { value: true });
    stubSnapshotReply(async () => redirected);
    expect(await saveReadyPage(store.storage, path, livePage(), NOW)).toBe(false);
    expect(await (await readyPageFallback(store.storage, path, NOW))?.text()).toContain("previous");
  });

  it("deletes a matching-path copy that is not a snapshot, never on a wrong-path probe", async () => {
    await saveReadyPage(store.storage, `/ready/${TOKEN}`, page(), NOW);
    const cache = await store.storage.open(READY_CACHE_NAME);
    const previous = await cache.match(READY_COPY_KEY);
    // An older copy was the page's own HTML; a damaged one lost a document.
    for (const body of [`<html><p>An older saved page</p></html>`, `{"saved":"<p>x</p>"}`]) {
      await cache.put(READY_COPY_KEY, new Response(body, { headers: previous?.headers }));
      expect(
        await readyPageFallback(store.storage, `/ready/${OTHER}`, NOW + 1_000),
      ).toBeUndefined();
      expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(1);
      expect(
        await readyPageFallback(store.storage, `/ready/${TOKEN}`, NOW + 1_000),
      ).toBeUndefined();
      expect(store.caches.get(READY_CACHE_NAME)?.size ?? 0).toBe(0);
      await cache.put(READY_COPY_KEY, new Response("x", { headers: previous?.headers }));
    }
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
    stubSnapshotReply(new Response("Not found", { status: 404 }));
    expect(await saveReadyPage(store.storage, path, livePage("<p>Cancelled</p>"), NOW)).toBe(false);
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(0);
    expect(await saveReadyPage(store.storage, path, page("x", {}, NOW - 1), NOW)).toBe(false);
  });

  it("forgets the copy for a path, and only that path's", async () => {
    await saveReadyPage(store.storage, `/ready/${TOKEN}`, page(), NOW);
    await forgetReadyPage(store.storage, `/ready/${OTHER}`, NOW);
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(1);
    await forgetReadyPage(store.storage, `/ready/${TOKEN}`, NOW);
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(0);
  });

  it("keeps cancellation ordering in one bounded storage record across many paths", async () => {
    for (let index = 0; index < 20; index += 1) {
      await forgetReadyPage(store.storage, `/ready/${String(index).padStart(43, "A")}`, NOW);
    }
    expect(store.caches.get(READY_FORGOTTEN_CACHE_NAME)?.size).toBe(1);
  });

  /**
   * Security review 2026-10-24 (#2979, finding 2): on a slow link a keep
   * request's fetch can start before the cancel and answer after it. What it
   * brings back is the pre-cancel page, and it must not revive the copy.
   */
  it("stores nothing from a fetch that began before the path was forgotten", async () => {
    const path = `/ready/${TOKEN}`;
    const staleRequest = await beginReadyPageRequest(store.storage, path);
    await forgetReadyPage(store.storage, path, NOW + 10);
    expect(await saveReadyPage(store.storage, path, page("stale"), NOW + 20, staleRequest)).toBe(
      false,
    );
    expect(store.caches.get(READY_CACHE_NAME)?.size ?? 0).toBe(0);
    // A load asked for after the forget is kept as ever, and another path is untouched.
    const freshRequest = await beginReadyPageRequest(store.storage, path);
    expect(await saveReadyPage(store.storage, path, page("fresh"), NOW + 20, freshRequest)).toBe(
      true,
    );
    const otherRequest = await beginReadyPageRequest(store.storage, `/ready/${OTHER}`);
    expect(
      await saveReadyPage(store.storage, `/ready/${OTHER}`, page("other"), NOW + 20, otherRequest),
    ).toBe(true);
  });

  it("keeps the cancellation epoch across worker restart when the device clock moves backward", async () => {
    const path = `/ready/${TOKEN}`;
    const request = await beginReadyPageRequest(store.storage, path);
    const cancellationObserved = NOW - 10;
    await forgetReadyPage(store.storage, path, cancellationObserved);
    vi.resetModules();
    const restarted = await import("./ready-page-cache");

    expect(
      await restarted.saveReadyPage(
        store.storage,
        path,
        page("pre-cancel page"),
        NOW + 20,
        request,
      ),
    ).toBe(false);
    expect(await restarted.readyPageFallback(store.storage, path, NOW + 20)).toBeUndefined();
  });

  it("lets only the newest overlapping request publish, even after a worker restart", async () => {
    const path = `/ready/${TOKEN}`;
    const older = await beginReadyPageRequest(store.storage, path);
    const newer = await beginReadyPageRequest(store.storage, path);

    expect(await saveReadyPage(store.storage, path, page("newer response"), NOW, newer)).toBe(true);
    expect(await saveReadyPage(store.storage, path, page("older response"), NOW, older)).toBe(
      false,
    );
    expect(await (await readyPageFallback(store.storage, path, NOW))?.text()).toContain(
      "newer response",
    );
  });

  it("drops the copy a save put down when the forget lands while it was storing", async () => {
    const path = `/ready/${TOKEN}`;
    const request = await beginReadyPageRequest(store.storage, path);
    const open = store.storage.open.bind(store.storage);
    let forgot = false;
    let forgetting: Promise<boolean> | undefined;
    const racing = {
      delete: store.storage.delete.bind(store.storage),
      open: async (name: string) => {
        const cache = await open(name);
        return {
          ...cache,
          put: async (key: RequestInfo | URL, response: Response) => {
            await cache.put(key as string, response);
            if (!forgot && name === READY_CACHE_NAME) {
              forgot = true;
              forgetting = forgetReadyPage(store.storage, path, NOW + 10);
            }
          },
        };
      },
    } as unknown as CacheStorage;
    expect(await saveReadyPage(racing, path, page("stale"), NOW + 20, request)).toBe(false);
    expect(await forgetting).toBe(true);
    expect(store.caches.get(READY_CACHE_NAME)?.size ?? 0).toBe(0);
  });

  it("removes a stale copy when cancellation lands after validation but before the write completes", async () => {
    const path = `/ready/${TOKEN}`;
    const request = await beginReadyPageRequest(store.storage, path);
    const open = store.storage.open.bind(store.storage);
    let enteredPut: (() => void) | undefined;
    let releasePut: (() => void) | undefined;
    const putEntered = new Promise<void>((resolve) => {
      enteredPut = resolve;
    });
    const putGate = new Promise<void>((resolve) => {
      releasePut = resolve;
    });
    const racing = {
      delete: store.storage.delete.bind(store.storage),
      open: async (name: string) => {
        const cache = await open(name);
        return {
          ...cache,
          put: async (key: RequestInfo | URL, response: Response) => {
            if (name === READY_CACHE_NAME) {
              enteredPut?.();
              await putGate;
            }
            await cache.put(key as string, response);
          },
        };
      },
    } as unknown as CacheStorage;
    const saving = saveReadyPage(racing, path, page("pre-cancel page"), NOW, request);

    await putEntered;
    const forgetting = forgetReadyPage(store.storage, path, NOW - 10);
    releasePut?.();

    expect(await saving).toBe(false);
    expect(await forgetting).toBe(true);
    expect(store.caches.get(READY_CACHE_NAME)?.size ?? 0).toBe(0);
  });

  /** Finding 3: a forget that cannot read the copy takes the whole cache rather than none of it. */
  it("deletes the whole copy cache when the forget itself fails", async () => {
    await saveReadyPage(store.storage, `/ready/${TOKEN}`, page(), NOW);
    const broken = {
      delete: store.storage.delete.bind(store.storage),
      open: async () => {
        throw new Error("storage gone");
      },
    } as unknown as CacheStorage;
    await forgetReadyPage(broken, `/ready/${TOKEN}`, NOW);
    expect(store.caches.has(READY_CACHE_NAME)).toBe(false);
  });

  it("does not acknowledge a failed epoch write or let an in-flight save republish", async () => {
    const path = `/ready/${TOKEN}`;
    const pendingRequest = beginReadyPageRequest(store.storage, path);
    const broken = {
      delete: store.storage.delete.bind(store.storage),
      open: async (name: string) => {
        const cache = await store.storage.open(name);
        if (name !== READY_FORGOTTEN_CACHE_NAME) return cache;
        return {
          ...cache,
          put: async () => {
            throw new Error("quota exceeded");
          },
        };
      },
    } as unknown as CacheStorage;

    const forgetting = forgetReadyPage(broken, path, NOW);
    const request = await pendingRequest;
    expect(await forgetting).toBe(false);
    expect(
      await saveReadyPage(store.storage, path, page("pre-forget response"), NOW, request),
    ).toBe(false);
    expect(store.caches.get(READY_CACHE_NAME)?.size ?? 0).toBe(0);

    // A later request durably replaces the old request ID even though the
    // dedicated forget attempt failed; after restart, the old response stays stale.
    await beginReadyPageRequest(store.storage, path);
    vi.resetModules();
    const restarted = await import("./ready-page-cache");
    expect(
      await restarted.saveReadyPage(store.storage, path, page("pre-forget response"), NOW, request),
    ).toBe(false);
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

describe("a copy older than what the diver last saw online", () => {
  let store: ReturnType<typeof fakeStorage>;
  const path = `/ready/${TOKEN}`;
  beforeEach(async () => {
    store = fakeStorage();
    await saveReadyPage(store.storage, path, page("Dock call 8:00"), NOW);
  });

  it.each([
    ["a timeout", () => Promise.reject(new DOMException("timed out", "TimeoutError"))],
    ["a throttle (429)", () => Promise.resolve(new Response("slow down", { status: 429 }))],
    ["a server error", () => Promise.resolve(new Response("oops", { status: 503 }))],
  ])("labels the held copy, and keeps it, after %s", async (_case, reply) => {
    stubSnapshotReply(reply);
    expect(await saveReadyPage(store.storage, path, livePage(), NOW)).toBe(false);
    const served = await (await readyPageFallback(store.storage, path, NOW))?.text();
    expect(served).toContain("Dock call 8:00");
    expect(served).toContain("Newer details were seen online.");
  });

  it("serves an unlabelled copy when nothing newer was seen", async () => {
    const served = await (await readyPageFallback(store.storage, path, NOW))?.text();
    expect(served).not.toContain("Newer details were seen online.");
  });

  it("a later good snapshot replaces the copy and drops the label", async () => {
    stubSnapshotReply(async () => new Response("no", { status: 429 }));
    await saveReadyPage(store.storage, path, livePage(), NOW);
    expect(await saveReadyPage(store.storage, path, page("Dock call 7:00"), NOW)).toBe(true);
    const served = await (await readyPageFallback(store.storage, path, NOW))?.text();
    expect(served).toContain("Dock call 7:00");
    expect(served).not.toContain("Newer details were seen online.");
  });

  it("escapes the notice, which is text", async () => {
    stubSnapshotReply(async () => new Response("no", { status: 429 }));
    await saveReadyPage(store.storage, path, livePage(), NOW);
    const cache = await store.storage.open(READY_CACHE_NAME);
    const kept = await cache.match(READY_COPY_KEY);
    const body = JSON.parse((await kept?.text()) ?? "{}");
    await cache.put(
      READY_COPY_KEY,
      new Response(JSON.stringify({ ...body, staleNotice: "<script>x</script>" }), {
        headers: kept?.headers,
      }),
    );
    const served = await (await readyPageFallback(store.storage, path, NOW))?.text();
    expect(served).not.toContain("<script>");
    expect(served).toContain("&lt;script&gt;");
  });
});

describe("purgeLegacyReadyCopies", () => {
  it("deletes old HTML copies and keeps a valid snapshot", async () => {
    const store = fakeStorage();
    const path = `/ready/${TOKEN}`;
    await saveReadyPage(store.storage, path, page("kept"), NOW);
    const cache = await store.storage.open(READY_CACHE_NAME);
    await cache.put(`/ready/${OTHER}`, new Response("<html>old redacted page</html>"));
    await purgeLegacyReadyCopies(store.storage);
    expect([...(store.caches.get(READY_CACHE_NAME)?.keys() ?? [])]).toEqual([READY_COPY_KEY]);
    expect(await (await readyPageFallback(store.storage, path, NOW))?.text()).toContain("kept");
  });

  it("deletes a copy under the snapshot's own key whose body is old HTML", async () => {
    const store = fakeStorage();
    const cache = await store.storage.open(READY_CACHE_NAME);
    await cache.put(READY_COPY_KEY, new Response("<html>old redacted page</html>"));
    await purgeLegacyReadyCopies(store.storage);
    expect(store.caches.get(READY_CACHE_NAME)?.size).toBe(0);
  });

  it("does not create the cache when there is none", async () => {
    const store = fakeStorage();
    await purgeLegacyReadyCopies(store.storage);
    expect(store.caches.has(READY_CACHE_NAME)).toBe(false);
  });
});
