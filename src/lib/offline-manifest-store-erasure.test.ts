// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  appendOfflineRollCall,
  loadOfflineManifest,
  saveOfflineManifest,
  syncOfflineManifest,
} from "./offline-manifest-store";
import type { OfflineManifestPayload } from "./offline-manifests";

const tripId = "11111111-1111-1111-1111-111111111111";
const bookingId = "22222222-2222-2222-2222-222222222222";
const crewPersonId = "33333333-3333-3333-3333-333333333333";
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
    const envelope = await appendOfflineRollCall(tripId, {
      bookingId,
      checkpoint: "after_dive_2",
      status: "not_boarded",
      note: "A second private note.",
    });
    expect(envelope.events.map((event) => event.note)).toEqual([
      "Nora Quinn was seen at the ladder.",
      "A second private note.",
    ]);

    server.use(
      http.post("/api/offline-manifests/sync", () =>
        HttpResponse.json({
          results: envelope.events.map((event, index) => ({
            clientEventId: event.clientEventId,
            status: "applied",
            noteDisposition:
              index === 0 ? "discarded_erasure_cutoff" : "discarded_unverified_snapshot",
          })),
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
  });
});
