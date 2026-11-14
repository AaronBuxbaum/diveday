// @vitest-environment jsdom
// `syncOfflineManifest`'s deadline, beside offline-manifest-store.test.ts
// (which is at its file-length ceiling). Same harness: real fake-indexeddb,
// the request answered (or not) by msw.
import "fake-indexeddb/auto";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { withRefreshedSyncFrame } from "@/test/offline-sync-frame";
import {
  appendOfflineArrival,
  appendOfflineRollCall,
  loadOfflineManifest,
  saveOfflineManifest,
  syncOfflineManifest,
} from "./offline-manifest-store";
import type {
  OfflineArrivalEvent,
  OfflineManifestPayload,
  OfflineRollCallEvent,
} from "./offline-manifests";

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

function indexedDbReset() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("diveday-offline-manifests");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("failed to reset IndexedDB"));
  });
}

afterEach(indexedDbReset);

for (const kind of ["warning", "settlement"] as const) {
  for (const casing of ["same", "upper"] as const) {
    it(`does not apply a ${kind} receipt after an in-flight ${casing}-case ID collision`, async () => {
      const tripId = payload.manifests[0].trip.id;
      const bookingId = payload.manifests[0].divers[0].bookingId;
      await saveOfflineManifest(payload);
      const initialUuid = vi
        .spyOn(crypto, "randomUUID")
        .mockReturnValue("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      let queued: Awaited<ReturnType<typeof appendOfflineRollCall>>;
      try {
        queued = await appendOfflineRollCall(tripId, {
          bookingId,
          checkpoint: "after_dive_1",
          status: "not_boarded",
          note: "Keep this observation",
        });
      } finally {
        initialUuid.mockRestore();
      }
      const event = queued.events[0];
      let release!: () => void;
      let seen!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const posted = new Promise<void>((resolve) => {
        seen = resolve;
      });
      server.use(
        http.post("/api/offline-manifests/sync", async () => {
          seen();
          await gate;
          const result =
            kind === "warning"
              ? {
                  clientEventId: event.clientEventId,
                  status: "unresolved",
                  reason: "client_event_conflict",
                  noteDisposition: "discarded_erasure_cutoff",
                }
              : { clientEventId: event.clientEventId, status: "applied" };
          return HttpResponse.json(
            withRefreshedSyncFrame(payload, { results: [result] }, { events: [event] }),
          );
        }),
      );
      const attempt = syncOfflineManifest(tripId);
      await posted;
      const id = casing === "upper" ? event.clientEventId.toUpperCase() : event.clientEventId;
      const uuid = vi
        .spyOn(crypto, "randomUUID")
        .mockReturnValue(id as ReturnType<typeof crypto.randomUUID>);
      try {
        await appendOfflineArrival(tripId, { bookingId, status: "arrived" });
      } finally {
        uuid.mockRestore();
        release();
      }
      await expect(attempt).rejects.toBeDefined();
      const stored = await loadOfflineManifest(tripId);
      expect(stored?.events[0]).toMatchObject({
        clientEventId: event.clientEventId,
        syncStatus: "pending",
        note: "Keep this observation",
      });
      expect(stored?.arrivalEvents?.[0]).toMatchObject({
        clientEventId: id,
        syncStatus: "pending",
      });
    });
  }
}

for (const casing of ["same", "upper"] as const) {
  it(`does not apply a receipt across a settled ${casing}-case ID collision`, async () => {
    const tripId = payload.manifests[0].trip.id;
    const bookingId = payload.manifests[0].divers[0].bookingId;
    await saveOfflineManifest(payload);
    const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    let uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue(id);
    let arrival: OfflineArrivalEvent;
    try {
      const queued = await appendOfflineArrival(tripId, { bookingId, status: "arrived" });
      if (!queued.arrivalEvents?.[0]) throw new Error("arrival missing");
      arrival = queued.arrivalEvents[0];
    } finally {
      uuid.mockRestore();
    }
    server.use(
      http.post("/api/offline-manifests/sync", () =>
        HttpResponse.json(
          withRefreshedSyncFrame(
            payload,
            { results: [{ clientEventId: id, status: "applied" }] },
            { arrivalEvents: [arrival] },
          ),
        ),
      ),
    );
    await syncOfflineManifest(tripId);
    uuid = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue(
        (casing === "upper" ? id.toUpperCase() : id) as ReturnType<typeof crypto.randomUUID>,
      );
    let roll: OfflineRollCallEvent;
    try {
      const queued = await appendOfflineRollCall(tripId, {
        bookingId,
        checkpoint: "after_dive_1",
        status: "not_boarded",
        note: "Keep this observation",
      });
      roll = queued.events[0];
    } finally {
      uuid.mockRestore();
    }
    server.use(
      http.post("/api/offline-manifests/sync", () =>
        HttpResponse.json({
          results: [
            {
              clientEventId: roll.clientEventId,
              status: "unresolved",
              reason: "client_event_conflict",
              noteDisposition: "discarded_erasure_cutoff",
            },
          ],
        }),
      ),
    );
    await expect(syncOfflineManifest(tripId)).rejects.toBeDefined();
    const stored = await loadOfflineManifest(tripId);
    expect(stored?.events[0]).toMatchObject({
      clientEventId: roll.clientEventId,
      syncStatus: "pending",
      note: "Keep this observation",
    });
    expect(stored?.arrivalEvents?.[0]).toMatchObject({ clientEventId: id, syncStatus: "applied" });
  });
}
