// @vitest-environment jsdom
// `syncOfflineManifest`'s deadline, beside offline-manifest-store.test.ts
// (which is at its file-length ceiling). Same harness: real fake-indexeddb,
// the request answered (or not) by msw.
import "fake-indexeddb/auto";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendOfflineArrival,
  appendOfflineChecklistCheck,
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
    // Bounded by real time, not a turn count: under a loaded machine the
    // IndexedDB read and the interceptor took more than 10,000 turns, and the
    // count ran out before the request was sent (flaked in a full run).
    // `performance.now` is real here — only setTimeout/clearTimeout are faked.
    const started = performance.now();
    while (posts === 0 && performance.now() - started < 5_000) {
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

  /** One pass that gives up at the deadline, the captain's queue left as it was. */
  async function abandonedPass() {
    const first = syncOfflineManifest(tripId);
    await giveUpAfter(first, 10_000);
    await expect(first).rejects.toMatchObject({ code: "sync_unreachable" });
  }

  /**
   * Auditor review S3, case 3: the abandoned POST landed, so the server
   * answers the resend `duplicate`. That is the server saying "already on
   * the record", and the device must settle the event, not refuse it or keep
   * sending it.
   */
  it("settles an event the server says it already holds, after the device gave up on it", async () => {
    const queued = await queueOneEvent();
    let answer = false;
    server.use(
      http.post("/api/offline-manifests/sync", async ({ request }) => {
        posts += 1;
        const body = (await request.json()) as { events: Array<{ clientEventId: string }> };
        if (!answer) return new Promise<never>(() => {});
        return HttpResponse.json({
          results: body.events.map((event) => ({
            clientEventId: event.clientEventId,
            status: "duplicate",
          })),
        });
      }),
    );

    await abandonedPass();
    answer = true;
    vi.useRealTimers();
    const second = await syncOfflineManifest(tripId);

    expect(second?.events).toEqual([
      expect.objectContaining({ clientEventId: queued.clientEventId, syncStatus: "applied" }),
    ]);
  });

  /**
   * Case 1: an answer that arrives after the device gave up is not read. A
   * refusal landing at 10,001 ms must not mark the event refused; the next
   * pass's answer is the one that counts.
   */
  it("ignores an answer that arrives after it gave up, and takes the next pass's", async () => {
    const queued = await queueOneEvent();
    let pass = 0;
    server.use(
      http.post("/api/offline-manifests/sync", async ({ request }) => {
        posts += 1;
        pass += 1;
        const body = (await request.json()) as { events: Array<{ clientEventId: string }> };
        const status = pass === 1 ? "rejected" : "applied";
        if (pass === 1) await new Promise((resolve) => setTimeout(resolve, 10_001));
        return HttpResponse.json({
          results: body.events.map((event) => ({
            clientEventId: event.clientEventId,
            status,
            ...(status === "rejected" ? { reason: "newer_event_exists" } : {}),
          })),
        });
      }),
    );

    await abandonedPass();
    await vi.advanceTimersByTimeAsync(1);
    for (let turn = 0; turn < 50; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect((await loadOfflineManifest(tripId))?.events[0]).toMatchObject({
      clientEventId: queued.clientEventId,
      syncStatus: "pending",
    });

    vi.useRealTimers();
    const second = await syncOfflineManifest(tripId);
    expect(second?.events[0]).toMatchObject({
      clientEventId: queued.clientEventId,
      syncStatus: "applied",
    });
    expect(second?.events[0]?.rejectionReason).toBeUndefined();
  });

  /**
   * Case 2: the captain keeps counting while the POST hangs. That tap must
   * survive the give-up, and the next pass sends both, in the order tapped.
   */
  it("keeps a tap made while the sync hung, and sends it next, in order", async () => {
    const first = await queueOneEvent();
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

    const hanging = syncOfflineManifest(tripId);
    const gaveUp = hanging.catch((error: unknown) => error);
    for (let turn = 0; posts === 0 && turn < 10_000; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const during = await appendOfflineRollCall(tripId, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "after_dive_1",
      status: "cleared",
      retractsClientEventId: first.clientEventId,
    });
    const second = during.events[1];
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await gaveUp).toMatchObject({ code: "sync_unreachable" });
    expect((await loadOfflineManifest(tripId))?.events.map((event) => event.syncStatus)).toEqual([
      "pending",
      "pending",
    ]);

    answer = true;
    vi.useRealTimers();
    const settled = await syncOfflineManifest(tripId);

    expect(sentIds).toEqual([[first.clientEventId], [first.clientEventId, second.clientEventId]]);
    expect(settled?.events.map((event) => event.syncStatus)).toEqual(["applied", "applied"]);
  });

  /**
   * Auditor review S3, case 5: a checklist tick and a counter arrival ride
   * the same POST as the roll call. Through a pass the device gave up on,
   * both stay pending and untouched, go again under the same ids, and settle
   * when the server answers that it already holds them.
   */
  it("keeps checklist and arrival taps through a give-up, and settles them on the same ids", async () => {
    await saveOfflineManifest({
      ...payload,
      checklist: { items: [{ id: "item-radio", label: "Radio check" }] },
    });
    const ticked = (
      await appendOfflineChecklistCheck(tripId, {
        checklistItemId: "item-radio",
        status: "checked",
        note: null,
      })
    ).checklistEvents[0];
    const arrived = (
      await appendOfflineArrival(tripId, {
        bookingId: payload.manifests[0].divers[0].bookingId,
        status: "arrived",
      })
    ).arrivalEvents?.[0];
    if (!ticked || !arrived) throw new Error("the taps were not queued");
    const sent: string[][] = [];
    let answer = false;
    server.use(
      http.post("/api/offline-manifests/sync", async ({ request }) => {
        posts += 1;
        const body = (await request.json()) as {
          checklistEvents: Array<{ clientEventId: string }>;
          arrivalEvents: Array<{ clientEventId: string }>;
        };
        const ids = [...body.checklistEvents, ...body.arrivalEvents].map(
          (event) => event.clientEventId,
        );
        sent.push(ids);
        if (!answer) return new Promise<never>(() => {});
        return HttpResponse.json({
          results: ids.map((clientEventId) => ({ clientEventId, status: "duplicate" })),
        });
      }),
    );

    await abandonedPass();
    const kept = await loadOfflineManifest(tripId);
    expect(kept?.checklistEvents).toEqual([ticked]);
    expect(kept?.arrivalEvents).toEqual([arrived]);

    answer = true;
    vi.useRealTimers();
    const settled = await syncOfflineManifest(tripId);

    expect(sent).toEqual([
      [ticked.clientEventId, arrived.clientEventId],
      [ticked.clientEventId, arrived.clientEventId],
    ]);
    expect(settled?.checklistEvents.map((event) => event.syncStatus)).toEqual(["applied"]);
    expect(settled?.arrivalEvents?.map((event) => event.syncStatus)).toEqual(["applied"]);
  });
});
