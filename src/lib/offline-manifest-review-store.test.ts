// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { TEST_FROZEN_CLOCK } from "@/test/frozen-clock";
import { withRefreshedSyncFrame } from "@/test/offline-sync-frame";
import {
  appendOfflineChecklistCheck,
  appendOfflineRollCall,
  beginOfflineTenantVerificationRound,
  completeOfflineRollCallConfirmation,
  discardOfflineRollCallReview,
  loadOfflineManifest,
  OFFLINE_MANIFEST_PENDING_GRACE_MS,
  prepareOfflineRollCallConfirmation,
  readDiscardedOfflineRecords,
  releaseOfflineRollCallConfirmation,
  saveOfflineManifest,
  syncOfflineManifest,
} from "./offline-manifest-store";
import type { OfflineManifestPayload } from "./offline-manifests";

const FROZEN_MS = Date.parse(TEST_FROZEN_CLOCK);
const DAY_MS = 24 * 60 * 60 * 1000;

// Expired one day inside the pending grace boundary, avoiding rounding ambiguity.
const EXPIRED_WITHIN_GRACE = new Date(
  FROZEN_MS - OFFLINE_MANIFEST_PENDING_GRACE_MS + DAY_MS,
).toISOString();

/** The same record a day past the ceiling: the reprieve is over, pending or not. */
const EXPIRED_PAST_GRACE = new Date(
  FROZEN_MS - OFFLINE_MANIFEST_PENDING_GRACE_MS - DAY_MS,
).toISOString();

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
        title: "Two-Tank Reef — Molasses & French",
        startsAt: "2026-08-01T13:00:00.000Z",
        endsAt: "2026-08-01T16:30:00.000Z",
        plannedDives: 2,
      },
      checkpoint: "departure",
      crew: [
        {
          // A copy saved since H-20260814-where-diveday-sit-between carries the crew member's person id, which
          // is what makes the crew half of the head count recordable here.
          id: "33333333-3333-3333-3333-333333333333",
          fullName: "Sal Moretti",
          roles: ["captain"],
        },
      ],
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

/** Backdates a stored record's plaintext expiry without touching its ciphertext. */
function patchStoredExpiresAt(tripId: string, expiresAt: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests");
    request.onsuccess = () => {
      const db = request.result;
      const getRequest = db
        .transaction("manifests", "readonly")
        .objectStore("manifests")
        .get(tripId);
      getRequest.onsuccess = () => {
        const record = getRequest.result;
        record.expiresAt = expiresAt;
        const writeTransaction = db.transaction("manifests", "readwrite");
        writeTransaction.objectStore("manifests").put(record);
        writeTransaction.oncomplete = () => {
          db.close();
          resolve();
        };
        writeTransaction.onerror = () => reject(writeTransaction.error);
      };
      getRequest.onerror = () => reject(getRequest.error);
    };
    request.onerror = () => reject(request.error);
  });
}

/** The raw stored row, to tell "deleted" apart from "not returned to a reader". */
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Each device keeps one IndexedDB record per trip; wipe it between tests so a
// prior test's synced/rejected events can't bleed into the next one's.
afterEach(
  () =>
    new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("diveday-offline-manifests");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("failed to reset IndexedDB"));
    }),
);

describe("offline roll-call review storage", () => {
  it("discards only the selected review and keeps dependent observations pending", async () => {
    const tripId = payload.manifests[0].trip.id;
    await saveOfflineManifest(payload);
    const first = await appendOfflineRollCall(tripId, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "not_boarded",
    });
    const original = first.events[0];
    const queued = await appendOfflineRollCall(tripId, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "boarded",
      observedEvidenceIds: [`client:${original.clientEventId}`],
    });
    const dependent = queued.events[1];
    server.use(
      http.post("/api/offline-manifests/sync", () =>
        HttpResponse.json(
          withRefreshedSyncFrame(
            payload,
            {
              results: [
                {
                  clientEventId: original.clientEventId,
                  status: "rejected",
                  reason: "review_required",
                },
                {
                  clientEventId: dependent.clientEventId,
                  status: "rejected",
                  reason: "causal_dependency_unresolved",
                },
              ],
            },
            { events: queued.events },
          ),
        ),
      ),
    );
    await syncOfflineManifest(tripId);
    const round = await beginOfflineTenantVerificationRound();
    const reserved = await prepareOfflineRollCallConfirmation(
      tripId,
      original.clientEventId,
      "boarded",
      payload.shop.slug,
      round,
      { snapshotId: "current-snapshot", meetingDay: 0, witness: "current-proof" },
    );
    await expect(
      discardOfflineRollCallReview(tripId, original.clientEventId, payload.shop.slug, round),
    ).rejects.toMatchObject({ code: "not_allowed" });
    await expect(
      releaseOfflineRollCallConfirmation(
        tripId,
        original.clientEventId,
        "different-id",
        payload.shop.slug,
        round,
      ),
    ).rejects.toMatchObject({ code: "not_allowed" });
    await releaseOfflineRollCallConfirmation(
      tripId,
      original.clientEventId,
      reserved.confirmationId,
      payload.shop.slug,
      round,
    );
    await discardOfflineRollCallReview(tripId, original.clientEventId, payload.shop.slug, round);
    const saved = await loadOfflineManifest(tripId);
    expect(saved?.events).toHaveLength(1);
    expect(saved?.events[0]).toMatchObject({
      clientEventId: dependent.clientEventId,
      syncStatus: "pending",
      reviewRequired: true,
      rejectionReason: "causal_dependency_unresolved",
    });
  });
  it("durably reuses one confirmation identity and keeps the original observation", async () => {
    const tripId = payload.manifests[0].trip.id;
    await saveOfflineManifest(payload);
    const queued = await appendOfflineRollCall(tripId, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "not_boarded",
    });
    const original = queued.events[0];
    server.use(
      http.post("/api/offline-manifests/sync", () =>
        HttpResponse.json(
          withRefreshedSyncFrame(
            payload,
            {
              results: [
                {
                  clientEventId: original.clientEventId,
                  status: "rejected",
                  reason: "review_required",
                },
              ],
            },
            { events: queued.events },
          ),
        ),
      ),
    );
    await syncOfflineManifest(tripId);
    const round = await beginOfflineTenantVerificationRound();
    const context = { snapshotId: "review-snapshot", meetingDay: 0, witness: "first-proof" };
    const first = await prepareOfflineRollCallConfirmation(
      tripId,
      original.clientEventId,
      "boarded",
      payload.shop.slug,
      round,
      context,
    );
    const again = await prepareOfflineRollCallConfirmation(
      tripId,
      original.clientEventId,
      "boarded",
      payload.shop.slug,
      round,
      { ...context, witness: "later-proof" },
    );
    expect(first.confirmationId).not.toBe(original.clientEventId);
    expect(again.confirmationId).toBe(first.confirmationId);
    expect(again.context).toEqual(context);
    expect((await loadOfflineManifest(tripId))?.events[0]).toMatchObject({
      clientEventId: original.clientEventId,
      reviewRequired: true,
      reviewConfirmation: { clientEventId: first.confirmationId, status: "boarded" },
    });
    await expect(
      prepareOfflineRollCallConfirmation(
        tripId,
        original.clientEventId,
        "not_boarded",
        payload.shop.slug,
        round,
        context,
      ),
    ).rejects.toMatchObject({ code: "not_allowed" });
    await completeOfflineRollCallConfirmation(
      tripId,
      original.clientEventId,
      first.confirmationId,
      payload.shop.slug,
      round,
    );
    expect((await loadOfflineManifest(tripId))?.events[0]).toMatchObject({
      clientEventId: original.clientEventId,
      reviewResolution: "confirmed",
      reviewConfirmation: { clientEventId: first.confirmationId, status: "boarded" },
    });
  });
  it("does not upgrade storage later after an older tab blocks and the save fails", async () => {
    const old = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("diveday-offline-manifests", 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore("keys");
        open.result.createObjectStore("manifests", { keyPath: "tripId" });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    await expect(saveOfflineManifest(payload)).rejects.toThrow("blocked by an older tab");
    old.close();
    const reopened = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("diveday-offline-manifests", 1);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    expect(reopened.version).toBe(1);
    reopened.close();
  });
  it("keeps newly queued evidence while a cached version-1 shell is refused storage access", async () => {
    const tripId = payload.manifests[0].trip.id;
    await saveOfflineManifest(payload);
    const queued = await appendOfflineRollCall(tripId, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "not_boarded",
    });
    const error = await new Promise<DOMException | null>((resolve) => {
      const open = indexedDB.open("diveday-offline-manifests", 1);
      open.onerror = () => resolve(open.error);
      open.onsuccess = () => {
        open.result.close();
        resolve(null);
      };
    });
    expect(error?.name).toBe("VersionError");
    expect((await loadOfflineManifest(tripId))?.events).toEqual(queued.events);
  });
  it("does not turn an applied event back into review when an older request finishes later", async () => {
    const tripId = payload.manifests[0].trip.id;
    await saveOfflineManifest(payload);
    const queued = await appendOfflineRollCall(tripId, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "not_boarded",
    });
    const original = queued.events[0];
    let start!: () => void, release!: () => void;
    const started = new Promise<void>((r) => {
      start = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    server.use(
      http.post("/api/offline-manifests/sync", async () => {
        calls++;
        if (calls === 1) {
          start();
          await gate;
          return HttpResponse.json(
            withRefreshedSyncFrame(
              payload,
              {
                results: [
                  {
                    clientEventId: original.clientEventId,
                    status: "rejected",
                    reason: "booking_unavailable",
                  },
                ],
              },
              { events: queued.events, revision: 3 },
            ),
          );
        }
        return HttpResponse.json(
          withRefreshedSyncFrame(
            payload,
            { results: [{ clientEventId: original.clientEventId, status: "applied" }] },
            { events: queued.events, revision: 2 },
          ),
        );
      }),
    );
    const round = await beginOfflineTenantVerificationRound();
    const older = syncOfflineManifest(tripId, payload.shop.slug, round);
    await started;
    await syncOfflineManifest(tripId, payload.shop.slug, round);
    release();
    await older;
    expect((await loadOfflineManifest(tripId))?.events[0]).toMatchObject({
      clientEventId: original.clientEventId,
      syncStatus: "applied",
    });
    expect((await loadOfflineManifest(tripId))?.events[0].reviewRequired).not.toBe(true);
  });
  it("marks an unanswered roll-call observation for review without settling it", async () => {
    const tripId = payload.manifests[0].trip.id;
    await saveOfflineManifest(payload);
    const queued = await appendOfflineRollCall(tripId, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "not_boarded",
    });
    const original = queued.events[0];
    server.use(
      http.post("/api/offline-manifests/sync", () =>
        HttpResponse.json(withRefreshedSyncFrame(payload, { results: [] }, { events: [] })),
      ),
    );
    expect((await syncOfflineManifest(tripId))?.events[0]).toMatchObject({
      clientEventId: original.clientEventId,
      syncStatus: "pending",
      reviewRequired: true,
      rejectionReason: "unanswered_observation",
    });
  });
  it("does not settle an event for an unrecognized server outcome", async () => {
    const tripId = payload.manifests[0].trip.id;
    await saveOfflineManifest(payload);
    const queued = await appendOfflineRollCall(tripId, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "not_boarded",
    });
    const original = queued.events[0];
    server.use(
      http.post("/api/offline-manifests/sync", () => {
        const frame = withRefreshedSyncFrame(payload, { results: [] }, { events: [] });
        return HttpResponse.json({
          ...frame,
          results: [{ clientEventId: original.clientEventId, status: "unknown" }],
        });
      }),
    );
    expect((await syncOfflineManifest(tripId))?.events[0]).toMatchObject({
      clientEventId: original.clientEventId,
      syncStatus: "pending",
      reviewRequired: true,
      rejectionReason: "unrecognized_observation",
    });
  });
  it.each(["booking_unavailable", "review_required"])(
    "retains %s for review while applying an independent event",
    async (reason) => {
      const tripId = payload.manifests[0].trip.id;
      await saveOfflineManifest(payload);
      const first = await appendOfflineRollCall(tripId, {
        bookingId: payload.manifests[0].divers[0].bookingId,
        checkpoint: "departure",
        status: "not_boarded",
        note: "Synthetic observation",
      });
      const original = first.events[0];
      const second = await appendOfflineRollCall(tripId, {
        bookingId: payload.manifests[0].divers[0].bookingId,
        checkpoint: "departure",
        status: "not_boarded",
      });
      const independent = second.events[1];
      let posts = 0;
      server.use(
        http.post("/api/offline-manifests/sync", () => {
          posts++;
          return HttpResponse.json(
            withRefreshedSyncFrame(
              payload,
              {
                results: [
                  {
                    clientEventId: original.clientEventId,
                    status: "rejected",
                    reason,
                    noteDisposition: "discarded_unverified_snapshot",
                  },
                  { clientEventId: independent.clientEventId, status: "applied" },
                ],
              },
              { events: second.events },
            ),
          );
        }),
      );
      const synced = await syncOfflineManifest(tripId);
      expect(synced?.events[0]).toMatchObject({
        clientEventId: original.clientEventId,
        syncStatus: "pending",
        reviewRequired: true,
        rejectionReason: reason,
        note: null,
        noteDisposition: "discarded_unverified_snapshot",
      });
      expect(synced?.events[1]).toMatchObject({
        clientEventId: independent.clientEventId,
        syncStatus: "applied",
      });
      expect((await loadOfflineManifest(tripId))?.events[0]).toEqual(synced?.events[0]);
      await syncOfflineManifest(tripId);
      expect(posts).toBe(1);
      await patchStoredExpiresAt(tripId, EXPIRED_WITHIN_GRACE);
      expect((await loadOfflineManifest(tripId))?.events[0]).toMatchObject({
        clientEventId: original.clientEventId,
        syncStatus: "pending",
        reviewRequired: true,
      });
      await patchStoredExpiresAt(tripId, EXPIRED_PAST_GRACE);
      expect(await loadOfflineManifest(tripId)).toBeNull();
      expect(await readDiscardedOfflineRecords()).toMatchObject([{ tripId, pendingEvents: 1 }]);
    },
  );
  it("retains a checklist review while an unrelated roll-call event syncs", async () => {
    const tripId = payload.manifests[0].trip.id;
    const checklistItemId = "44444444-4444-4444-4444-444444444444";
    const copy = {
      ...payload,
      checklist: { items: [{ id: checklistItemId, label: "Oxygen aboard" }] },
    };
    await saveOfflineManifest(copy);
    await appendOfflineRollCall(tripId, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "not_boarded",
    });
    const queued = await appendOfflineChecklistCheck(tripId, {
      checklistItemId,
      status: "checked",
      note: "Synthetic note",
    });
    let posts = 0;
    server.use(
      http.post("/api/offline-manifests/sync", () => {
        posts++;
        return HttpResponse.json(
          withRefreshedSyncFrame(
            copy,
            {
              results: [
                { clientEventId: queued.events[0].clientEventId, status: "applied" },
                {
                  clientEventId: queued.checklistEvents[0].clientEventId,
                  status: "rejected",
                  reason: "review_required",
                  noteDisposition: "discarded_unverified_snapshot",
                },
              ],
            },
            { events: queued.events, checklistEvents: queued.checklistEvents },
          ),
        );
      }),
    );
    const synced = await syncOfflineManifest(tripId);
    expect(synced?.events[0]).toMatchObject({ syncStatus: "applied" });
    expect(synced?.checklistEvents[0]).toMatchObject({
      clientEventId: queued.checklistEvents[0].clientEventId,
      syncStatus: "pending",
      reviewRequired: true,
      rejectionReason: "review_required",
      note: null,
      noteDisposition: "discarded_unverified_snapshot",
    });
    expect((await loadOfflineManifest(tripId))?.checklistEvents[0]).toEqual(
      synced?.checklistEvents[0],
    );
    await syncOfflineManifest(tripId);
    expect(posts).toBe(1);
  });
});
