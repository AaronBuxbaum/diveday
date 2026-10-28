// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  appendOfflineChecklistCheck,
  appendOfflineRollCall,
  loadOfflineManifest,
  saveOfflineManifest,
  syncOfflineManifest,
} from "./offline-manifest-store";
import type { OfflineManifestPayload } from "./offline-manifests";

const tripId = "11111111-1111-1111-1111-111111111111";
const bookingId = "22222222-2222-2222-2222-222222222222";
const crewPersonId = "33333333-3333-3333-3333-333333333333";
const checklistItemId = "44444444-4444-4444-8444-444444444444";
const payload: OfflineManifestPayload = {
  shop: {
    slug: "blue-mantis",
    name: "Blue Mantis Divers",
    timezone: "America/New_York",
    emergencyReference: { lines: [], vessel: "", shoreContact: "", plan: "" },
  },
  snapshotId: "55555555-5555-4555-8555-555555555555",
  erasureEpochToken: "signed-epoch-token",
  checklist: { items: [{ id: checklistItemId, label: "Oxygen aboard" }] },
  manifests: [
    {
      trip: {
        id: tripId,
        title: "Two-Tank Reef — Molasses & French",
        startsAt: "2026-08-01T13:00:00.000Z",
        endsAt: "2026-08-01T16:30:00.000Z",
        plannedDives: 2,
      },
      checkpoint: "departure",
      crew: [{ id: crewPersonId, fullName: "Sal Moretti", roles: ["captain"] }],
      divers: [
        {
          bookingId,
          fullName: "Nora Quinn",
          email: null,
          emergencyContactName: "Sam Quinn",
          emergencyContactPhone: "+1-305-555-0100",
          readiness: { status: "ready", blockers: [] },
          rentalFit: { state: "not_recorded" },
          nitroxRequested: false,
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
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
afterEach(
  () =>
    new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("diveday-offline-manifests");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("failed to reset IndexedDB"));
    }),
);

describe("discarded offline roll-call notes", () => {
  it("clears each acknowledged note while preserving its roll-call mark", async () => {
    await saveOfflineManifest(payload);
    await appendOfflineRollCall(tripId, {
      crewPersonId,
      checkpoint: "after_dive_1",
      status: "not_boarded",
      note: "Nora Quinn was seen at the ladder.",
    });
    const rollCallEnvelope = await appendOfflineRollCall(tripId, {
      bookingId,
      checkpoint: "after_dive_2",
      status: "not_boarded",
      note: "A second private note.",
    });
    const envelope = await appendOfflineChecklistCheck(tripId, {
      checklistItemId,
      status: "checked",
      note: "A checklist note naming the diver.",
    });
    expect(rollCallEnvelope.events.map((event) => event.note)).toEqual([
      "Nora Quinn was seen at the ladder.",
      "A second private note.",
    ]);
    expect(envelope.checklistEvents[0]?.erasureEpochToken).toBe("signed-epoch-token");

    server.use(
      http.post("/api/offline-manifests/sync", () =>
        HttpResponse.json({
          results: [
            ...envelope.events.map((event, index) => ({
              clientEventId: event.clientEventId,
              status: "applied",
              noteDisposition:
                index === 0 ? "discarded_erasure_cutoff" : "discarded_unverified_snapshot",
            })),
            {
              clientEventId: envelope.checklistEvents[0]?.clientEventId,
              status: "applied",
              noteDisposition: "discarded_erasure_cutoff",
            },
          ],
        }),
      ),
    );

    const synced = await syncOfflineManifest(tripId);
    expect(synced?.events).toMatchObject([
      {
        status: "not_boarded",
        syncStatus: "applied",
        note: null,
        noteDisposition: "discarded_erasure_cutoff",
      },
      {
        status: "not_boarded",
        syncStatus: "applied",
        note: null,
        noteDisposition: "discarded_unverified_snapshot",
      },
    ]);
    const reloaded = await loadOfflineManifest(tripId);
    expect(reloaded?.events.map((event) => event.note)).toEqual([null, null]);
    expect(reloaded?.events.map((event) => event.checkpoint)).toEqual([
      "after_dive_1",
      "after_dive_2",
    ]);
    expect(reloaded?.checklistEvents).toMatchObject([
      {
        status: "checked",
        syncStatus: "applied",
        note: null,
        noteDisposition: "discarded_erasure_cutoff",
      },
    ]);
  });

  it("clears applied notes when a newer erasure epoch replaces the saved snapshot", async () => {
    const epochPayload = (epoch: number, snapshotId: string): OfflineManifestPayload => ({
      ...payload,
      snapshotId,
      erasureEpochToken: `${epoch}.${"A".repeat(43)}`,
    });
    await saveOfflineManifest(epochPayload(12, "55555555-5555-4555-8555-555555555555"));
    await appendOfflineRollCall(tripId, {
      bookingId,
      checkpoint: "after_dive_1",
      status: "not_boarded",
      note: "Applied diver note naming Nora Quinn.",
    });
    await appendOfflineRollCall(tripId, {
      crewPersonId,
      checkpoint: "after_dive_1",
      status: "not_boarded",
      note: "Applied crew note naming Nora Quinn.",
    });
    const queued = await appendOfflineChecklistCheck(tripId, {
      checklistItemId,
      status: "checked",
      note: "Applied checklist note naming Nora Quinn.",
    });
    const tapTimes = [
      ...queued.events.map((event) => event.occurredAt),
      ...queued.checklistEvents.map((event) => event.occurredAt),
    ];
    server.use(
      http.post("/api/offline-manifests/sync", () =>
        HttpResponse.json({
          results: [...queued.events, ...queued.checklistEvents].map((event) => ({
            clientEventId: event.clientEventId,
            status: "applied",
          })),
        }),
      ),
    );
    const applied = await syncOfflineManifest(tripId);
    expect(applied?.events.map((event) => event.syncStatus)).toEqual(["applied", "applied"]);
    expect(applied?.checklistEvents[0]?.syncStatus).toBe("applied");

    const sameEpoch = await saveOfflineManifest(
      epochPayload(12, "66666666-6666-4666-8666-666666666666"),
    );
    expect(sameEpoch.events.map((event) => event.note)).toEqual([
      "Applied diver note naming Nora Quinn.",
      "Applied crew note naming Nora Quinn.",
    ]);
    expect(sameEpoch.checklistEvents[0]?.note).toBe("Applied checklist note naming Nora Quinn.");

    const refreshed = await saveOfflineManifest(
      epochPayload(13, "77777777-7777-4777-8777-777777777777"),
    );
    expect(refreshed.events).toMatchObject([
      {
        bookingId,
        checkpoint: "after_dive_1",
        status: "not_boarded",
        syncStatus: "applied",
        note: null,
        noteDisposition: "discarded_erasure_cutoff",
      },
      {
        crewPersonId,
        checkpoint: "after_dive_1",
        status: "not_boarded",
        syncStatus: "applied",
        note: null,
        noteDisposition: "discarded_erasure_cutoff",
      },
    ]);
    expect(refreshed.checklistEvents).toMatchObject([
      {
        checklistItemId,
        status: "checked",
        syncStatus: "applied",
        note: null,
        noteDisposition: "discarded_erasure_cutoff",
      },
    ]);
    expect([
      ...refreshed.events.map((event) => event.occurredAt),
      ...refreshed.checklistEvents.map((event) => event.occurredAt),
    ]).toEqual(tapTimes);

    const stalePayload = {
      ...epochPayload(12, "88888888-8888-4888-8888-888888888888"),
      manifests: payload.manifests.map((manifest) => ({
        ...manifest,
        trip: { ...manifest.trip, title: "Pre-erasure copy with Nora Quinn" },
        divers: manifest.divers.map((diver) => ({ ...diver, fullName: "Nora Quinn" })),
      })),
    };
    const afterOutOfOrderRefresh = await saveOfflineManifest(stalePayload);
    expect(afterOutOfOrderRefresh.snapshot.snapshotId).toBe("77777777-7777-4777-8777-777777777777");
    expect(afterOutOfOrderRefresh.snapshot.manifests[0].trip.title).toBe(
      "Two-Tank Reef — Molasses & French",
    );
    expect(afterOutOfOrderRefresh.events.map((event) => event.note)).toEqual([null, null]);
  });
});
