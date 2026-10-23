// @vitest-environment jsdom
// `syncOfflineManifest`'s deadline, beside offline-manifest-store.test.ts
// (which is at its file-length ceiling). Same harness: real fake-indexeddb,
// the request answered (or not) by msw.
import "fake-indexeddb/auto";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendOfflineRollCall,
  loadOfflineManifest,
  saveOfflineManifest,
  syncOfflineManifest,
} from "./offline-manifest-store";
import type { OfflineManifestPayload } from "./offline-manifests";

const payload: OfflineManifestPayload = {
  shop: {
    slug: "blue-mantis",
    name: "Blue Mantis Divers",
    timezone: "America/New_York",
    emergencyReference: { lines: [], vessel: "", shoreContact: "", plan: "" },
  },
  manifests: [
    {
      trip: {
        id: "11111111-1111-1111-1111-111111111111",
        title: "Two-Tank Reef",
        startsAt: "2026-08-01T13:00:00.000Z",
        endsAt: "2026-08-01T16:30:00.000Z",
        plannedDives: 2,
      },
      checkpoint: "departure",
      crew: [],
      divers: [
        {
          bookingId: "22222222-2222-2222-2222-222222222222",
          fullName: "Nora Quinn",
          email: null,
          emergencyContactName: "Sam Quinn",
          emergencyContactPhone: "+1-305-555-0100",
          readiness: { status: "ready", blockers: [] },
          rentalFit: { state: "not_recorded" as const },
          nitroxRequested: false,
          rollCall: undefined,
        },
      ],
      summary: {
        totalDivers: 1,
        ready: 1,
        blocked: 0,
        boarded: 0,
        notBoarded: 0,
        notBackAboard: 0,
        awaiting: 1,
        unaccountedFor: 1,
        overCapacity: 0,
        notHere: 0,
      },
    },
  ],
};

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

afterEach(
  () =>
    new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("diveday-offline-manifests");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("failed to reset IndexedDB"));
    }),
);

/**
 * Dock Wi-Fi with full bars that carries nothing: the POST neither answers
 * nor fails. Before the deadline this sync waited forever, and every later
 * reconcile queued behind it until the page was reloaded.
 */
describe("syncOfflineManifest on a network that never answers", () => {
  const tripId = payload.manifests[0].trip.id;

  async function queueOneEvent() {
    await saveOfflineManifest(payload);
    const envelope = await appendOfflineRollCall(tripId, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "after_dive_1",
      status: "not_boarded",
    });
    return envelope.events[0];
  }

  /** Lets the real IndexedDB work run, then moves the deadline clock on. */
  async function giveUpAfter<T>(promise: Promise<T>, ms: number) {
    let state: unknown = "waiting";
    promise.then(
      () => {
        state = "resolved";
      },
      (error: unknown) => {
        state = error;
      },
    );
    // Polled on setImmediate, not vi.waitFor: the latter advances the faked
    // clock while it polls, which would spend the deadline being measured.
    for (let turn = 0; posts === 0 && turn < 10_000; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(posts).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(ms);
    await new Promise((resolve) => setImmediate(resolve));
    return state;
  }

  let posts = 0;

  beforeEach(() => {
    posts = 0;
    // Only the deadline's own timers: fake-indexeddb schedules on setImmediate.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives up after ten seconds and keeps the event pending, untouched", async () => {
    const queued = await queueOneEvent();
    server.use(
      http.post("/api/offline-manifests/sync", () => {
        posts += 1;
        return new Promise<never>(() => {});
      }),
    );

    const attempt = syncOfflineManifest(tripId);
    expect(await giveUpAfter(attempt, 9_999)).toBe("waiting");
    await vi.advanceTimersByTimeAsync(1);
    await expect(attempt).rejects.toMatchObject({ code: "sync_unreachable" });

    const reloaded = await loadOfflineManifest(tripId);
    expect(reloaded?.events).toEqual([queued]);
  });

  it("gives up on a reply whose body never finishes arriving", async () => {
    await queueOneEvent();
    server.use(
      http.post("/api/offline-manifests/sync", () => {
        posts += 1;
        return new HttpResponse(new ReadableStream({ start() {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const attempt = syncOfflineManifest(tripId);
    await giveUpAfter(attempt, 10_000);
    await expect(attempt).rejects.toMatchObject({ code: "sync_unreachable" });
    expect((await loadOfflineManifest(tripId))?.events[0].syncStatus).toBe("pending");
  });

  /**
   * A POST we gave up on may still have landed. The retry is safe only
   * because it resends the *same* `clientEventId`, which the server dedupes
   * on (`roll_call_events_shop_client_event_unique`, `(shop_id,
   * client_event_id)`), answering the replay as a duplicate rather than a
   * second row. A retry that minted a fresh id would record the diver twice.
   */
  it("resends the same event id on the next pass, and settles it once", async () => {
    const queued = await queueOneEvent();
    const sentIds: string[][] = [];
    let answer = false;
    server.use(
      http.post("/api/offline-manifests/sync", async ({ request }) => {
        posts += 1;
        const body = (await request.json()) as { events: Array<{ clientEventId: string }> };
        sentIds.push(body.events.map((event) => event.clientEventId));
        if (!answer) return new Promise<never>(() => {});
        return HttpResponse.json({
          results: body.events.map((event) => ({
            clientEventId: event.clientEventId,
            status: "applied",
          })),
        });
      }),
    );

    const first = syncOfflineManifest(tripId);
    await giveUpAfter(first, 10_000);
    await expect(first).rejects.toMatchObject({ code: "sync_unreachable" });

    answer = true;
    vi.useRealTimers();
    const second = await syncOfflineManifest(tripId);

    expect(sentIds).toEqual([[queued.clientEventId], [queued.clientEventId]]);
    expect(second?.events).toHaveLength(1);
    expect(second?.events[0]).toMatchObject({
      clientEventId: queued.clientEventId,
      syncStatus: "applied",
    });
  });
});
