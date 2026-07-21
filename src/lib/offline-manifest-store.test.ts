// @vitest-environment jsdom
// Browser-side store: exercises navigator.onLine, IndexedDB, and fetch paths.
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

const payload: OfflineManifestPayload = {
  shop: { slug: "blue-mantis", name: "Blue Mantis Divers", timezone: "America/New_York" },
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
      crew: [{ fullName: "Sal Moretti", roles: ["captain"] }],
      divers: [
        {
          bookingId: "22222222-2222-2222-2222-222222222222",
          fullName: "Nora Quinn",
          email: null,
          emergencyContactName: "Sam Quinn",
          emergencyContactPhone: "+1-305-555-0100",
          readiness: { status: "ready", blockers: [] },
          rentalFit: { state: "not_recorded" as const, text: "No fit on file — not asked yet" },
          nitroxRequested: false,
          rollCall: undefined,
        },
      ],
      summary: { totalDivers: 1, ready: 1, blocked: 0, boarded: 0, notBoarded: 0, awaiting: 1 },
    },
  ],
};

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
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

describe("syncOfflineManifest", () => {
  it("marks a pending event applied once the server accepts it", async () => {
    await saveOfflineManifest(payload);
    const envelope = await appendOfflineRollCall(payload.manifests[0].trip.id, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "not_boarded",
      note: null,
    });
    const pendingEvent = envelope.events[0];
    expect(pendingEvent.syncStatus).toBe("pending");

    server.use(
      http.post("/api/offline-manifests/sync", async ({ request }) => {
        const body = (await request.json()) as { events: Array<{ clientEventId: string }> };
        expect(body.events).toHaveLength(1);
        expect(body.events[0].clientEventId).toBe(pendingEvent.clientEventId);
        return HttpResponse.json({
          results: [{ clientEventId: pendingEvent.clientEventId, status: "applied" }],
        });
      }),
    );

    const synced = await syncOfflineManifest(payload.manifests[0].trip.id);
    expect(synced?.events[0].syncStatus).toBe("applied");

    const reloaded = await loadOfflineManifest(payload.manifests[0].trip.id);
    expect(reloaded?.events[0].syncStatus).toBe("applied");
  });

  it("marks a rejected event with the server's reason instead of silently dropping it", async () => {
    await saveOfflineManifest(payload);
    const envelope = await appendOfflineRollCall(payload.manifests[0].trip.id, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "boarded",
      note: null,
    });
    const pendingEvent = envelope.events[0];

    server.use(
      http.post("/api/offline-manifests/sync", () =>
        HttpResponse.json({
          results: [
            {
              clientEventId: pendingEvent.clientEventId,
              status: "rejected",
              reason: "stale_readiness",
            },
          ],
        }),
      ),
    );

    const synced = await syncOfflineManifest(payload.manifests[0].trip.id);
    expect(synced?.events[0].syncStatus).toBe("rejected");
    expect(synced?.events[0].rejectionReason).toBe("stale_readiness");
  });

  it("throws instead of silently discarding pending events when the server errors", async () => {
    await saveOfflineManifest(payload);
    await appendOfflineRollCall(payload.manifests[0].trip.id, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "not_boarded",
      note: null,
    });

    server.use(
      http.post("/api/offline-manifests/sync", () => new HttpResponse(null, { status: 500 })),
    );

    await expect(syncOfflineManifest(payload.manifests[0].trip.id)).rejects.toThrow(
      /could not reconcile/,
    );

    const reloaded = await loadOfflineManifest(payload.manifests[0].trip.id);
    expect(reloaded?.events[0].syncStatus).toBe("pending");
  });
});
