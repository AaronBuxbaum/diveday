// Deliberately the default `node` environment, not jsdom: a service worker is
// the one place in this repo that is *not* a DOM context (see
// src/worker/tsconfig.json), and borrowing jsdom's `window` to stand in for
// `ServiceWorkerGlobalScope` would test a global the shipped worker never has.
// The scope below is built by hand instead, and the worker is driven through
// the only surface it actually exposes: its own events.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MANIFEST_SYNC_TAG } from "@/lib/background-flush";
import {
  listOfflineManifests,
  purgeOfflineManifestsExceptShop,
  saveOfflineManifest,
  syncOfflineManifest,
  wipeOfflineMedicalAlerts,
} from "@/lib/offline-manifest-store";
import {
  OFFLINE_MANIFEST_RECORD_VERSION,
  type OfflineManifestEnvelope,
  type OfflineManifestPayload,
  type OfflineRollCallEvent,
} from "@/lib/offline-manifests";
import { READY_CACHE_NAME, READY_KEEP_UNTIL_META } from "@/lib/ready-offline";

vi.mock("@/lib/offline-manifest-store", () => ({
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
  clients: { matchAll: clientsMatchAll },
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
  vi.mocked(listOfflineManifests).mockResolvedValue([]);
  vi.mocked(purgeOfflineManifestsExceptShop).mockResolvedValue(undefined);
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
    expect(syncOfflineManifest).toHaveBeenCalledWith("trip-mine");
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

    expect(purgeOfflineManifestsExceptShop).toHaveBeenCalledWith("blue-mantis");
    expect(saveOfflineManifest).toHaveBeenCalledTimes(1);
    expect(vi.mocked(purgeOfflineManifestsExceptShop).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(saveOfflineManifest).mock.invocationCallOrder[0],
    );
    // Medical alert words go before the board is written (H-153): this body
    // names nobody, so all of them.
    expect(wipeOfflineMedicalAlerts).toHaveBeenCalledWith(undefined);
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

  /** The live page, naming the day its copy may be kept until (well past the frozen clock). */
  const html = (body: string) =>
    new Response(
      `<meta name="${READY_KEEP_UNTIL_META}" content="${Number.MAX_SAFE_INTEGER}"/>${body}`,
      {
        status: 200,
        headers: { "content-type": "text/html" },
      },
    );

  /** Every other cache the worker opens here (the forget markers), kept apart from the copy. */
  const others = new Map<string, Response>();
  const otherStub = {
    keys: async () => [...others.keys()].map((path) => new Request(`https://dive.day${path}`)),
    delete: async (key: string | Request) =>
      others.delete(new URL(typeof key === "string" ? key : key.url, "https://dive.day").pathname),
    put: async (key: string | Request, response: Response) => {
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
    kept.clear();
    others.clear();
    vi.stubGlobal("caches", {
      open: async (name: string) => (name === READY_CACHE_NAME ? cacheStub : otherStub),
      match: async () => undefined,
      delete: async (name: string) => (name === READY_CACHE_NAME ? kept.clear() : others.clear()),
    });
    scope.registration.scope = "https://dive.day/ready/";
  });

  afterEach(() => {
    scope.registration.scope = "https://dive.day/";
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
    const forget = message("FORGET_READY_PAGE", `https://dive.day${PATH}?cancelled=1`);
    await forget.settle();
    answer?.(html("before the cancel"));
    await keep.settle();
    expect(kept.size).toBe(0);
    expect(keep.replies).toEqual([{ ok: false }]);
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
  let shellSaved = true;

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

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    shellSaved = true;
    vi.stubGlobal("caches", {
      match: async (key: string) =>
        shellSaved && key === "/offline-manifest" ? SHELL.clone() : undefined,
      open: async () => ({ put: async () => {}, match: async () => undefined }),
    });
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
