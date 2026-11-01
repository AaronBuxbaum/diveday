// Deliberately the default `node` environment, not jsdom: a service worker is
// the one place in this repo that is *not* a DOM context (see
// src/worker/tsconfig.json), and borrowing jsdom's `window` to stand in for
// `ServiceWorkerGlobalScope` would test a global the shipped worker never has.
// The scope below is built by hand instead, and the worker is driven through
// the only surface it actually exposes: its own events.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MANIFEST_SYNC_TAG } from "@/lib/background-flush";
import { nowMs } from "@/lib/clock";
import {
  beginOfflineTenantVerificationRound,
  listOfflineManifests,
  purgeOfflineManifestsExceptShop,
  saveOfflineManifest,
  syncOfflineManifest,
  wipeOfflineMedicalAlerts,
} from "@/lib/offline-manifest-store";
import {
  OFFLINE_MANIFEST_RECORD_VERSION,
  OFFLINE_MANIFEST_SHELL_VERSION,
  type OfflineManifestEnvelope,
  type OfflineManifestPayload,
  type OfflineRollCallEvent,
} from "@/lib/offline-manifests";
import { READY_CACHE_NAME } from "@/lib/ready-offline";
import { saveReadyPage } from "./ready-page-cache";

vi.mock("@/lib/offline-manifest-store", () => ({
  beginOfflineTenantVerificationRound: vi.fn().mockResolvedValue(1),
  listOfflineManifests: vi.fn(),
  purgeOfflineManifestsExceptShop: vi.fn(),
  saveOfflineManifest: vi.fn(),
  syncOfflineManifest: vi.fn(),
  wipeOfflineMedicalAlerts: vi.fn(),
}));

// Fixed strings rather than the frozen clock: nothing under test reads the
// clock (the store is mocked), so a real instant here would only be noise.
const SAVED_AT = "2026-08-01T09:00:00.000Z";
const EXPIRES_AT = "2026-08-15T09:00:00.000Z";

function tripPayload(tripId: string, shopSlug: string): OfflineManifestPayload {
  return {
    shop: {
      slug: shopSlug,
      name: shopSlug,
      timezone: "America/New_York",
      emergencyReference: { lines: [], vessel: "", shoreContact: "", plan: "" },
    },
    manifests: [
      {
        trip: {
          id: tripId,
          title: `Trip ${tripId}`,
          startsAt: "2026-08-01T13:00:00.000Z",
          endsAt: "2026-08-01T16:30:00.000Z",
          plannedDives: 1,
        },
        checkpoint: "departure",
        crew: [],
        divers: [],
        summary: {
          totalDivers: 0,
          ready: 0,
          blocked: 0,
          boarded: 0,
          notBoarded: 0,
          notBackAboard: 0,
          awaiting: 0,
          unaccountedFor: 0,
          overCapacity: 0,
          notHere: 0,
        },
      },
    ],
  };
}

function pendingEvent(tripId: string): OfflineRollCallEvent {
  return {
    clientEventId: `evt-${tripId}`,
    snapshotId: `snap-${tripId}`,
    snapshotSavedAt: SAVED_AT,
    tripId,
    bookingId: `booking-${tripId}`,
    checkpoint: "departure",
    status: "boarded",
    occurredAt: SAVED_AT,
    syncStatus: "pending",
  };
}

function envelope(
  tripId: string,
  shopSlug: string,
  events: OfflineRollCallEvent[] = [],
): OfflineManifestEnvelope {
  return {
    snapshot: {
      ...tripPayload(tripId, shopSlug),
      version: OFFLINE_MANIFEST_RECORD_VERSION,
      snapshotId: `snap-${tripId}`,
      savedAt: SAVED_AT,
      expiresAt: EXPIRES_AT,
    },
    events,
    checklistEvents: [],
  };
}

function identityResponse(shopSlug: string): Response {
  return new Response(JSON.stringify({ shop: { slug: shopSlug } }), { status: 200 });
}

function upcomingResponse(shopSlug: string | null, payloads: OfflineManifestPayload[]): Response {
  return new Response(
    JSON.stringify(
      shopSlug === null
        ? { payloads }
        : { shop: { slug: shopSlug, name: shopSlug, timezone: "America/New_York" }, payloads },
    ),
    { status: 200 },
  );
}

/**
 * The worker's whole event surface, recorded as it registers. Driving the real
 * `push`/`sync` listeners — rather than exporting the two functions under test
 * — keeps the wiring itself covered: an `event.waitUntil` that is never called,
 * or a handler that returns before reaching the flush, is a real way this can
 * break on a boat and an exported-function test would not see either.
 */
const listeners = new Map<string, (event: unknown) => void>();
const clientsMatchAll = vi.fn();
const showNotification = vi.fn();
const fetchMock = vi.fn<(input: unknown, init?: unknown) => Promise<Response>>();

const scope = {
  addEventListener: (type: string, listener: (event: unknown) => void) => {
    listeners.set(type, listener);
  },
  clients: { claim: async () => {}, matchAll: clientsMatchAll },
  registration: { showNotification, scope: "https://dive.day/" },
  skipWaiting: () => {},
  location: new URL("https://dive.day/"),
};

function installGlobals(online = true) {
  vi.stubGlobal("self", scope);
  vi.stubGlobal("navigator", { onLine: online });
  vi.stubGlobal("fetch", fetchMock);
}

/** Route by path so a test declares only the endpoints it expects to be asked. */
function routeFetch(routes: { identity?: () => Response; upcoming?: () => Response }) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/offline-manifests/identity") && routes.identity) {
      return routes.identity();
    }
    if (url.includes("/api/offline-manifests/upcoming") && routes.upcoming) {
      return routes.upcoming();
    }
    throw new Error(`unexpected request from the worker: ${url}`);
  });
}

function fire(
  type: string,
  event: Record<string, unknown>,
): Promise<PromiseSettledResult<unknown>[]> {
  const handler = listeners.get(type);
  if (!handler) throw new Error(`the worker registered no "${type}" listener`);
  const waits: Array<Promise<unknown>> = [];
  handler({ ...event, waitUntil: (promise: Promise<unknown>) => waits.push(promise) });
  return Promise.allSettled(waits);
}

const fireSync = (tag = MANIFEST_SYNC_TAG) => fire("sync", { tag });
/** No `title` in the payload, so the handler stops before showNotification. */
const firePush = () => fire("push", { data: { json: () => ({ kind: "manifest-changed" }) } });

beforeAll(async () => {
  installGlobals();
  await import("./manifest-sw");
});

beforeEach(() => {
  vi.resetAllMocks();
  installGlobals();
  vi.mocked(beginOfflineTenantVerificationRound).mockResolvedValue(1);
  vi.mocked(listOfflineManifests).mockResolvedValue([]);
  vi.mocked(purgeOfflineManifestsExceptShop).mockResolvedValue([]);
  vi.mocked(saveOfflineManifest).mockResolvedValue(envelope("saved", "blue-mantis"));
  vi.mocked(syncOfflineManifest).mockResolvedValue(null);
  // No visible client, which is the only case where the worker does the work
  // itself instead of handing it to a page.
  clientsMatchAll.mockResolvedValue([]);
  showNotification.mockResolvedValue(undefined);
});

describe("flushPendingRollCall (the sync event)", () => {
  // Security review, 2026-08-06. This loop used to submit *every* envelope on
  // the device under whatever session the tablet currently holds. Traced
  // through: the sync route scopes to `session.user.shopId`, so a foreign
  // shop's event comes back `rejected`; `syncOfflineManifest` writes
  // `syncStatus: "rejected"`; a rejected event is no longer `pending`, so the
  // guard in `purgeOfflineManifestsExceptShop` stops protecting the record and
  // the next purge deletes it. Shop A's roll call, recorded offshore, gone —
  // with no page open to tell anyone.
  it("reconciles only the signed-in shop's records and leaves a foreign shop's alone", async () => {
    vi.mocked(listOfflineManifests).mockResolvedValue([
      envelope("trip-mine", "blue-mantis", [pendingEvent("trip-mine")]),
      envelope("trip-theirs", "reef-runners", [pendingEvent("trip-theirs")]),
    ]);
    routeFetch({ identity: () => identityResponse("blue-mantis") });

    await fireSync();

    expect(syncOfflineManifest).toHaveBeenCalledTimes(1);
    expect(syncOfflineManifest).toHaveBeenCalledWith("trip-mine", "blue-mantis", 1);
  });

  it.each([
    ["the endpoint refuses the caller", () => new Response(null, { status: 401 })],
    ["the shop row is gone", () => new Response(null, { status: 404 })],
    ["a 200 carries no slug", () => new Response(JSON.stringify({}), { status: 200 })],
    ["a 200 carries an empty slug", () => new Response(JSON.stringify({ shop: { slug: "" } }))],
  ])("reconciles nothing when %s", async (_label, identity) => {
    vi.mocked(listOfflineManifests).mockResolvedValue([
      envelope("trip-mine", "blue-mantis", [pendingEvent("trip-mine")]),
    ]);
    routeFetch({ identity });

    const settled = await fireSync();

    expect(syncOfflineManifest).not.toHaveBeenCalled();
    // Rejected rather than quietly resolved, so the browser keeps the tag and
    // tries again: the events are still on the device and this flush did not
    // happen. Guessing the tenant instead is what destroys the record.
    expect(settled.map((result) => result.status)).toEqual(["rejected"]);
  });

  it("reconciles nothing while the device has no signal", async () => {
    installGlobals(false);
    vi.mocked(listOfflineManifests).mockResolvedValue([
      envelope("trip-mine", "blue-mantis", [pendingEvent("trip-mine")]),
    ]);
    routeFetch({});

    await fireSync();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(syncOfflineManifest).not.toHaveBeenCalled();
  });

  it("asks the identity endpoint for the tenant and never pulls the roster to get it", async () => {
    vi.mocked(listOfflineManifests).mockResolvedValue([
      envelope("trip-mine", "blue-mantis", [pendingEvent("trip-mine")]),
    ]);
    routeFetch({ identity: () => identityResponse("blue-mantis") });

    await fireSync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/offline-manifests/identity");
  });

  it("spends no request at all when this device has nothing queued", async () => {
    vi.mocked(listOfflineManifests).mockResolvedValue([envelope("trip-mine", "blue-mantis")]);
    routeFetch({});

    await fireSync();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(syncOfflineManifest).not.toHaveBeenCalled();
  });

  it("ignores a sync event for somebody else's tag", async () => {
    vi.mocked(listOfflineManifests).mockResolvedValue([
      envelope("trip-mine", "blue-mantis", [pendingEvent("trip-mine")]),
    ]);

    await fireSync("some-other-feature");

    expect(listOfflineManifests).not.toHaveBeenCalled();
  });
});

describe("refreshSavedManifests (the push event)", () => {
  // Security review, 2026-08-06. This response already carries the
  // server-verified tenant at zero extra cost, and the worker was writing the
  // board without acting on it — so a push landing on a shared boat tablet with
  // no page open wrote shop B's whole 48-hour roster in beside shop A's
  // resident records, and nothing on the device ever removed them.
  it("purges the other shop's records before writing this shop's board", async () => {
    routeFetch({
      upcoming: () => upcomingResponse("blue-mantis", [tripPayload("trip-1", "blue-mantis")]),
    });

    await firePush();

    expect(beginOfflineTenantVerificationRound).toHaveBeenCalledTimes(1);
    expect(vi.mocked(beginOfflineTenantVerificationRound).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(fetch).mock.invocationCallOrder[0],
    );
    expect(purgeOfflineManifestsExceptShop).toHaveBeenCalledWith("blue-mantis", 1);
    expect(saveOfflineManifest).toHaveBeenCalledTimes(1);
    expect(vi.mocked(purgeOfflineManifestsExceptShop).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(saveOfflineManifest).mock.invocationCallOrder[0],
    );
    // Medical alert words go before the board is written (H-20261023-medical-alert-for-the): this body
    // names nobody, so all of them.
    expect(wipeOfflineMedicalAlerts).toHaveBeenCalledWith(undefined, 1);
    expect(vi.mocked(wipeOfflineMedicalAlerts).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(saveOfflineManifest).mock.invocationCallOrder[0],
    );
  });

  it("drops saved words on a departure the body does not say this viewer may hold (security review 2, L3)", async () => {
    routeFetch({
      upcoming: () => upcomingResponse("blue-mantis", [tripPayload("trip-1", "blue-mantis")]),
    });

    await firePush();

    // This body carries no `mayHoldMedicalAlertWords`: fail closed.
    expect(saveOfflineManifest).toHaveBeenCalledWith(expect.anything(), {
      keepMedicalAlertWords: false,
      tenantRound: 1,
    });
  });

  it.each([
    ["carries no shop", () => upcomingResponse(null, [tripPayload("trip-1", "blue-mantis")])],
    [
      "carries an empty slug",
      () =>
        new Response(
          JSON.stringify({ shop: { slug: "" }, payloads: [tripPayload("trip-1", "blue-mantis")] }),
          { status: 200 },
        ),
    ],
  ])("writes nothing when the board response %s", async (_label, upcoming) => {
    routeFetch({ upcoming });

    await firePush();

    expect(purgeOfflineManifestsExceptShop).not.toHaveBeenCalled();
    expect(saveOfflineManifest).not.toHaveBeenCalled();
  });

  /**
   * Issue #2981: on a dead link the board fetch neither answers nor fails,
   * and a notification waiting on it never shows: the captain gets no alert.
   * The refresh gets a deadline, and still runs on behind the notification.
   */
  it("shows the notification on time when the board fetch never answers", async () => {
    let answer: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const done = fire("push", {
        data: {
          json: () => ({ kind: "manifest-changed", tripId: "trip-1", title: "Manifest changed" }),
        },
      });
      await vi.advanceTimersByTimeAsync(4_000);
      expect(showNotification).toHaveBeenCalledWith(
        "Manifest changed",
        expect.objectContaining({ tag: "manifest-trip-1" }),
      );
      // The refresh is kept, not dropped: a late answer is still written.
      answer?.(upcomingResponse("blue-mantis", [tripPayload("trip-1", "blue-mantis")]));
      await done;
      expect(saveOfflineManifest).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes nothing when the purge itself fails", async () => {
    // Fail closed, the same order the page-side auto-save keeps: writing the
    // board anyway would leave both shops' rosters readable side by side.
    vi.mocked(purgeOfflineManifestsExceptShop).mockRejectedValue(new Error("storage gone"));
    routeFetch({
      upcoming: () => upcomingResponse("blue-mantis", [tripPayload("trip-1", "blue-mantis")]),
    });

    await firePush();

    expect(saveOfflineManifest).not.toHaveBeenCalled();
  });
});

/**
 * Dock Wi-Fi that shows full bars and carries nothing: the request neither
 * answers nor fails. Every fallback below used to wait for `fetch` to *fail*,
 * so on that network the captain stared at a blank tab instead of the saved
 * roll call. A fetch that never settles (and ignores its abort signal, the
 * worst case) is the adversary here.
 */
describe("a navigation on a network that never answers", () => {
  const SHELL = new Response("offline shell", { status: 200 });
  const TRIP = "0b6c3a52-6f1e-4c55-9d0a-2f1d8f2b9c11";
  const READY_PATH = `/ready/${"R".repeat(43)}`;
  const OTHER_READY_PATH = `/ready/${"S".repeat(43)}`;
  let shellSaved = true;
  const cacheEntries = new Map<string, Map<string, Response>>();

  const cachePath = (key: string | Request) =>
    new URL(typeof key === "string" ? key : key.url, "https://dive.day").pathname;
  const cacheStorage = {
    open: async (name: string) => {
      const entries = cacheEntries.get(name) ?? new Map<string, Response>();
      cacheEntries.set(name, entries);
      return {
        keys: async () => [...entries.keys()].map((path) => new Request(`https://dive.day${path}`)),
        match: async (key: string | Request) => entries.get(cachePath(key))?.clone(),
        put: async (key: string | Request, response: Response) => {
          entries.set(cachePath(key), response.clone());
        },
        delete: async (key: string | Request) => entries.delete(cachePath(key)),
      };
    },
    match: async (key: string | Request) =>
      shellSaved && key === "/offline-manifest" ? SHELL.clone() : undefined,
    delete: async (name: string) => cacheEntries.delete(name),
  };

  function navigate(url: string) {
    const handler = listeners.get("fetch");
    if (!handler) throw new Error("no fetch listener");
    let responded: Promise<Response> | undefined;
    handler({
      request: { url, method: "GET", mode: "navigate" },
      respondWith: (promise: Promise<Response>) => {
        responded = promise;
      },
      waitUntil: () => {},
    });
    if (!responded) throw new Error(`the worker left ${url} to the browser`);
    return responded;
  }

  function navigateReady(url: string) {
    const handler = listeners.get("fetch");
    if (!handler) throw new Error("no fetch listener");
    let responded: Promise<Response> | undefined;
    const waits: Promise<unknown>[] = [];
    const previousScope = scope.registration.scope;
    scope.registration.scope = "https://dive.day/ready/";
    try {
      handler({
        request: { url, method: "GET", mode: "navigate" },
        respondWith: (promise: Promise<Response>) => {
          responded = promise;
        },
        waitUntil: (promise: Promise<unknown>) => waits.push(promise),
      });
    } finally {
      scope.registration.scope = previousScope;
    }
    if (!responded) throw new Error(`the worker left ${url} to the browser`);
    return { response: responded, waits };
  }

  async function cacheReadyCopy(path: string, body: string) {
    const now = nowMs();
    vi.stubGlobal("fetch", async () =>
      Response.json({
        generatedAt: now,
        keepUntil: now + 24 * 60 * 60 * 1000,
        saved: `<p>${body}</p>`,
        unverified: `<p>unverified ${body}</p>`,
        rollback: "<p>rollback</p>",
        staleNotice: "older",
      }),
    );
    await saveReadyPage(
      cacheStorage as unknown as CacheStorage,
      path,
      new Response("<p>live</p>", { headers: { "content-type": "text/html" } }),
      now,
    );
    vi.stubGlobal("fetch", fetchMock);
  }

  /** Settles `promise` or reports that it is still waiting after `ms` of fake time. */
  async function settledAfter<T>(promise: Promise<T>, ms: number): Promise<T | "still waiting"> {
    const marker = Symbol("pending");
    let outcome: T | typeof marker = marker;
    promise.then((value) => {
      outcome = value;
    });
    await vi.advanceTimersByTimeAsync(ms);
    return outcome === marker ? "still waiting" : outcome;
  }

  const hung = () => new Promise<Response>(() => {});

  function hangingFetchStarted(): Promise<void> {
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    fetchMock.mockImplementationOnce(() => {
      resolveStarted();
      return hung();
    });
    return started;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    shellSaved = true;
    cacheEntries.clear();
    vi.stubGlobal("caches", cacheStorage);
    fetchMock.mockImplementation(hung);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lands the captain on the saved roll call within four seconds, checkpoint and all", async () => {
    const response = navigate(
      `https://dive.day/shop/blue-mantis/trips/${TRIP}/manifest?checkpoint=after_dive_1`,
    );
    expect(await settledAfter(response, 3_999)).toBe("still waiting");
    const landed = await settledAfter(response, 1);
    if (landed === "still waiting") throw new Error("still waiting at four seconds");
    expect(landed.status).toBe(302);
    expect(landed.headers.get("location")).toBe(
      `https://dive.day/offline-manifest?trip=${TRIP}&checkpoint=after_dive_1&fallback=slow`,
    );
  });

  it("asks the network to stop once it has given up on it", async () => {
    const response = navigate(`https://dive.day/shop/blue-mantis/trips/${TRIP}/manifest`);
    await settledAfter(response, 4_000);
    const init = fetchMock.mock.calls[0]?.[1] as { signal?: AbortSignal } | undefined;
    expect(init?.signal?.aborted).toBe(true);
  });

  it("lands the counter on its saved copy within four seconds", async () => {
    const landed = await settledAfter(
      navigate(`https://dive.day/shop/blue-mantis/trips/${TRIP}`),
      4_000,
    );
    if (landed === "still waiting") throw new Error("still waiting at four seconds");
    expect(landed.headers.get("location")).toBe(
      `https://dive.day/offline-manifest?trip=${TRIP}&fallback=slow`,
    );
  });

  it("lands the bare address on the saved copy within four seconds", async () => {
    const landed = await settledAfter(navigate("https://dive.day/"), 4_000);
    if (landed === "still waiting") throw new Error("still waiting at four seconds");
    expect(landed.headers.get("location")).toBe("https://dive.day/offline-manifest?fallback=slow");
  });

  it("serves the saved offline shell itself within four seconds", async () => {
    const landed = await settledAfter(navigate("https://dive.day/offline-manifest"), 4_000);
    if (landed === "still waiting") throw new Error("still waiting at four seconds");
    expect(await landed.text()).toBe("offline shell");
  });

  it("says a request that failed outright was a failure, not a slow answer", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    const landed = await settledAfter(
      navigate(`https://dive.day/shop/blue-mantis/trips/${TRIP}/manifest`),
      0,
    );
    if (landed === "still waiting") throw new Error("a failed request still waited");
    expect(landed.headers.get("location")).toBe(
      `https://dive.day/offline-manifest?trip=${TRIP}&fallback=failed`,
    );
  });

  /**
   * Captain review S3: the worker's own redirect is a second navigation, and
   * it went through the four-second wait again before the shell, so a dead
   * link put first paint at eight seconds. Timed end to end: the live
   * manifest, its redirect, and the shell that redirect names.
   */
  it("puts the saved roll call on screen within four seconds in all, redirect included", async () => {
    const live = navigate(`https://dive.day/shop/blue-mantis/trips/${TRIP}/manifest`);
    expect(await settledAfter(live, 3_999)).toBe("still waiting");
    const redirect = await settledAfter(live, 1);
    if (redirect === "still waiting") throw new Error("still waiting at four seconds");
    const location = redirect.headers.get("location");
    if (!location) throw new Error("the worker answered without a redirect");
    const requestsBeforeHop = fetchMock.mock.calls.length;

    const shell = await settledAfter(navigate(location), 0);

    if (shell === "still waiting") throw new Error("the hop to the shell waited again");
    expect(await shell.text()).toBe("offline shell");
    expect(fetchMock.mock.calls.length).toBe(requestsBeforeHop);
  });

  it("keeps waiting for a slow page when the device has nothing saved to show instead", async () => {
    shellSaved = false;
    let answer: (response: Response) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    const response = navigate(`https://dive.day/shop/blue-mantis/trips/${TRIP}/manifest`);
    expect(await settledAfter(response, 4_000)).toBe("still waiting");
    answer(new Response("live manifest", { status: 200 }));
    const landed = await settledAfter(response, 0);
    if (landed === "still waiting") throw new Error("the late page never arrived");
    expect(await landed.text()).toBe("live manifest");
  });

  it("serves a readiness network response that arrives just before the four-second deadline", async () => {
    const digest = vi.spyOn(crypto.subtle, "digest").mockResolvedValue(new Uint8Array(32).buffer);
    let resolveFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      resolveFetchStarted = resolve;
    });
    let answer: ((response: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetchStarted();
          answer = resolve;
        }),
    );
    const navigation = navigateReady(`https://dive.day${READY_PATH}`);
    // The save that follows asks the server for its snapshot.
    fetchMock.mockResolvedValueOnce(new Response("Not found", { status: 404 }));
    try {
      await fetchStarted;
      expect(await settledAfter(navigation.response, 3_999)).toBe("still waiting");
      answer?.(
        new Response("live readiness page", {
          headers: { "content-type": "text/html" },
        }),
      );
      const live = await settledAfter(navigation.response, 0);
      if (live === "still waiting") throw new Error("the live readiness page never arrived");
      expect(await live.text()).toBe("live readiness page");
      await Promise.allSettled(navigation.waits);
    } finally {
      digest.mockRestore();
    }
  });

  it("uses only the readiness copy for the exact path when the network is slow", async () => {
    // This test is about the four-second routing deadline, not native
    // WebCrypto scheduling. Hash deterministically so completion of the
    // saved-path check cannot race the fake clock's final microtask under
    // parallel test load. ready-page-cache.test.ts exercises the real digest.
    const digest = vi
      .spyOn(crypto.subtle, "digest")
      .mockImplementation(async (_algorithm, data) => {
        const input = new TextDecoder().decode(data);
        const bytes = new Uint8Array(32);
        let value = 2_166_136_261;
        for (let index = 0; index < input.length; index += 1) {
          value = Math.imul(value ^ (input.charCodeAt(index) ?? 0), 16_777_619);
        }
        for (let index = 0; index < bytes.length; index += 1) {
          value = Math.imul(value ^ index, 16_777_619);
          bytes[index] = value >>> 24;
        }
        return bytes.buffer;
      });
    try {
      await cacheReadyCopy(READY_PATH, "saved readiness page");

      const matchingFetchStarted = hangingFetchStarted();
      const matching = navigateReady(`https://dive.day${READY_PATH}`);
      await matchingFetchStarted;
      const saved = await settledAfter(matching.response, 4_000);
      if (saved === "still waiting") throw new Error("the saved readiness page never arrived");
      expect(await saved.text()).toContain("saved readiness page");

      const otherFetchStarted = hangingFetchStarted();
      const other = navigateReady(`https://dive.day${OTHER_READY_PATH}`);
      await otherFetchStarted;
      const missing = await settledAfter(other.response, 4_000);
      if (missing === "still waiting") throw new Error("a path without a saved page kept waiting");
      expect(missing.type).toBe("error");
    } finally {
      digest.mockRestore();
    }
  });

  it("returns the browser error and aborts an uncached readiness request at four seconds", async () => {
    const digest = vi.spyOn(crypto.subtle, "digest").mockResolvedValue(new Uint8Array(32).buffer);
    const fetchStarted = hangingFetchStarted();
    const navigation = navigateReady(`https://dive.day${READY_PATH}`);
    try {
      await fetchStarted;
      expect(await settledAfter(navigation.response, 3_999)).toBe("still waiting");
      const result = await settledAfter(navigation.response, 1);
      if (result === "still waiting") throw new Error("an uncached readiness page kept waiting");
      expect(result.type).toBe("error");
      const readinessRequest = fetchMock.mock.calls.find(([input, init]) => {
        const inputUrl =
          typeof input === "object" && input !== null && "url" in input
            ? String(input.url)
            : String(input);
        const url = new URL(inputUrl, "https://dive.day");
        const requestInit = init as { signal?: AbortSignal } | undefined;
        return url.pathname === READY_PATH && requestInit?.signal !== undefined;
      });
      expect(readinessRequest).toBeDefined();
      const init = readinessRequest?.[1] as { signal?: AbortSignal } | undefined;
      expect(init?.signal?.aborted).toBe(true);
    } finally {
      digest.mockRestore();
    }
  });

  it("ignores a readiness response that arrives after the uncached deadline", async () => {
    const digest = vi.spyOn(crypto.subtle, "digest").mockResolvedValue(new Uint8Array(32).buffer);
    let resolveFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      resolveFetchStarted = resolve;
    });
    let answer: ((response: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetchStarted();
          answer = resolve;
        }),
    );
    const navigation = navigateReady(`https://dive.day${READY_PATH}`);
    try {
      await fetchStarted;
      const failed = await settledAfter(navigation.response, 4_000);
      if (failed === "still waiting") throw new Error("the uncached readiness page kept waiting");
      expect(failed.type).toBe("error");

      answer?.(
        new Response("late readiness page", {
          headers: { "content-type": "text/html" },
        }),
      );
      await Promise.resolve();
      await Promise.allSettled(navigation.waits);
      expect(navigation.waits).toHaveLength(0);
      expect(cacheEntries.get(READY_CACHE_NAME)?.size ?? 0).toBe(0);
    } finally {
      digest.mockRestore();
    }
  });

  it("still serves the live page when it answers inside four seconds", async () => {
    fetchMock.mockImplementation(async () => new Response("live manifest", { status: 200 }));
    const landed = await settledAfter(
      navigate(`https://dive.day/shop/blue-mantis/trips/${TRIP}/manifest`),
      0,
    );
    if (landed === "still waiting") throw new Error("the live page never arrived");
    expect(await landed.text()).toBe("live manifest");
  });
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
