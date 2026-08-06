// Deliberately the default `node` environment, not jsdom: a service worker is
// the one place in this repo that is *not* a DOM context (see
// src/worker/tsconfig.json), and borrowing jsdom's `window` to stand in for
// `ServiceWorkerGlobalScope` would test a global the shipped worker never has.
// The scope below is built by hand instead, and the worker is driven through
// the only surface it actually exposes: its own events.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MANIFEST_SYNC_TAG } from "@/lib/background-flush";
import {
  listOfflineManifests,
  purgeOfflineManifestsExceptShop,
  saveOfflineManifest,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import {
  OFFLINE_MANIFEST_RECORD_VERSION,
  type OfflineManifestEnvelope,
  type OfflineManifestPayload,
  type OfflineRollCallEvent,
} from "@/lib/offline-manifests";

vi.mock("@/lib/offline-manifest-store", () => ({
  listOfflineManifests: vi.fn(),
  purgeOfflineManifestsExceptShop: vi.fn(),
  saveOfflineManifest: vi.fn(),
  syncOfflineManifest: vi.fn(),
}));

// Fixed strings rather than the frozen clock: nothing under test reads the
// clock (the store is mocked), so a real instant here would only be noise.
const SAVED_AT = "2026-08-01T09:00:00.000Z";
const EXPIRES_AT = "2026-08-15T09:00:00.000Z";

function tripPayload(tripId: string, shopSlug: string): OfflineManifestPayload {
  return {
    shop: { slug: shopSlug, name: shopSlug, timezone: "America/New_York" },
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
    note: null,
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
  registration: { showNotification },
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
