// @vitest-environment jsdom
// Browser-side store: exercises navigator.onLine, IndexedDB, and fetch paths.
import "fake-indexeddb/auto";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  appendOfflineRollCall,
  listOfflineManifests,
  loadOfflineManifest,
  purgeOfflineManifestsExceptShop,
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

// A second, distinct trip departing earlier than `payload`'s, so the list's
// soonest-departure-first ordering (ADR 20260726-shopwide-offline-manifest-priming)
// has something real to sort against.
const earlierPayload: OfflineManifestPayload = {
  shop: payload.shop,
  manifests: [
    {
      ...payload.manifests[0],
      trip: {
        ...payload.manifests[0].trip,
        id: "33333333-3333-3333-3333-333333333333",
        title: "Wreck & Reef — Duane",
        startsAt: "2026-07-30T09:00:00.000Z",
        endsAt: "2026-07-30T12:30:00.000Z",
      },
    },
  ],
};

// A trip saved by a *different* shop on the same device/browser — the
// cross-tenant scenario purgeOfflineManifestsExceptShop exists to close (see
// ADR 20260726-shopwide-offline-manifest-priming).
const otherShopPayload: OfflineManifestPayload = {
  shop: { slug: "reef-runners", name: "Reef Runners", timezone: "America/New_York" },
  manifests: [
    {
      ...payload.manifests[0],
      trip: {
        ...payload.manifests[0].trip,
        id: "44444444-4444-4444-4444-444444444444",
        title: "Morning Two-Tank",
        startsAt: "2026-08-02T13:00:00.000Z",
        endsAt: "2026-08-02T16:30:00.000Z",
      },
    },
  ],
};

/** Backdates a stored record's plaintext expiry without touching its ciphertext. */
function patchStoredExpiresAt(tripId: string, expiresAt: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 1);
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

describe("saveOfflineManifest", () => {
  it("still saves a fresh snapshot when the existing device record is corrupt or undecryptable", async () => {
    // Simulate storage corruption (a bad key, a version/AAD mismatch, flipped
    // bytes) by writing a record straight into IndexedDB that this module's
    // own AES-GCM key can never decrypt. There's no delete button on this
    // surface anymore, so a save must self-heal past this rather than
    // permanently failing every future save on the device.
    const tripId = payload.manifests[0].trip.id;
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("diveday-offline-manifests", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("keys")) db.createObjectStore("keys");
        if (!db.objectStoreNames.contains("manifests")) {
          db.createObjectStore("manifests", { keyPath: "tripId" });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("manifests", "readwrite");
        transaction.objectStore("manifests").put({
          tripId,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          iv: new Uint8Array(12).buffer,
          ciphertext: new Uint8Array([1, 2, 3, 4]).buffer,
        });
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });

    const envelope = await saveOfflineManifest(payload);
    expect(envelope.events).toEqual([]);

    const reloaded = await loadOfflineManifest(tripId);
    expect(reloaded?.snapshot.snapshotId).toBe(envelope.snapshot.snapshotId);
  });
});

describe("loadOfflineManifest", () => {
  it("keeps an expired record alive if it still has an unsynced pending event", async () => {
    const tripId = payload.manifests[0].trip.id;
    await saveOfflineManifest(payload);
    const envelope = await appendOfflineRollCall(tripId, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "not_boarded",
      note: null,
    });
    expect(envelope.events[0].syncStatus).toBe("pending");

    // Simulate the retention window having passed while that change never
    // made it to the server — there's no delete button, so this must not
    // silently destroy the only record of it.
    // Well before the frozen test clock (src/test/frozen-clock.ts) that
    // `nowDate()` reads in tests — using real wall-clock time here wouldn't
    // reliably be "in the past" relative to that frozen instant.
    await patchStoredExpiresAt(tripId, "2020-01-01T00:00:00.000Z");

    const reloaded = await loadOfflineManifest(tripId);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.events).toHaveLength(1);
    expect(reloaded?.events[0].syncStatus).toBe("pending");
  });

  it("deletes an expired record once it has no unsynced pending events", async () => {
    const tripId = payload.manifests[0].trip.id;
    await saveOfflineManifest(payload);
    // Well before the frozen test clock (src/test/frozen-clock.ts) that
    // `nowDate()` reads in tests — using real wall-clock time here wouldn't
    // reliably be "in the past" relative to that frozen instant.
    await patchStoredExpiresAt(tripId, "2020-01-01T00:00:00.000Z");

    const reloaded = await loadOfflineManifest(tripId);
    expect(reloaded).toBeNull();
  });
});

describe("listOfflineManifests", () => {
  it("returns every saved trip, soonest departure first", async () => {
    await saveOfflineManifest(payload);
    await saveOfflineManifest(earlierPayload);

    const list = await listOfflineManifests();
    expect(list.map((envelope) => envelope.snapshot.manifests[0].trip.id)).toEqual([
      earlierPayload.manifests[0].trip.id,
      payload.manifests[0].trip.id,
    ]);
  });

  it("omits an expired record with no unsynced pending event", async () => {
    await saveOfflineManifest(payload);
    await saveOfflineManifest(earlierPayload);
    await patchStoredExpiresAt(payload.manifests[0].trip.id, "2020-01-01T00:00:00.000Z");

    const list = await listOfflineManifests();
    expect(list.map((envelope) => envelope.snapshot.manifests[0].trip.id)).toEqual([
      earlierPayload.manifests[0].trip.id,
    ]);
  });

  it("keeps an expired record with a still-pending event, same as loadOfflineManifest", async () => {
    await saveOfflineManifest(payload);
    const tripId = payload.manifests[0].trip.id;
    await appendOfflineRollCall(tripId, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "not_boarded",
      note: null,
    });
    await patchStoredExpiresAt(tripId, "2020-01-01T00:00:00.000Z");

    const list = await listOfflineManifests();
    expect(list.map((envelope) => envelope.snapshot.manifests[0].trip.id)).toEqual([tripId]);
  });

  it("returns an empty list when nothing has been saved on this device", async () => {
    expect(await listOfflineManifests()).toEqual([]);
  });
});

describe("purgeOfflineManifestsExceptShop", () => {
  it("deletes every device record whose shop doesn't match, keeping the caller's own shop intact", async () => {
    await saveOfflineManifest(payload);
    await saveOfflineManifest(otherShopPayload);

    await purgeOfflineManifestsExceptShop(payload.shop.slug);

    const remaining = await listOfflineManifests();
    expect(remaining.map((envelope) => envelope.snapshot.shop.slug)).toEqual([payload.shop.slug]);
    expect(await loadOfflineManifest(otherShopPayload.manifests[0].trip.id)).toBeNull();
    expect(await loadOfflineManifest(payload.manifests[0].trip.id)).not.toBeNull();
  });

  it("is a no-op when every saved record already belongs to the given shop", async () => {
    await saveOfflineManifest(payload);
    await saveOfflineManifest(earlierPayload);

    await purgeOfflineManifestsExceptShop(payload.shop.slug);

    const remaining = await listOfflineManifests();
    expect(remaining).toHaveLength(2);
  });
});

describe("appendOfflineRollCall", () => {
  it("refuses to record a new roll call against a snapshot kept alive past its expiry", async () => {
    // A record preserved past retention (because it still has an unsynced
    // event) is not a boarding source — the H-05 stop rule treats expired the
    // same as missing, even though loadOfflineManifest keeps serving it so
    // the pending evidence can still reconcile.
    //
    // Patching the stored record's plaintext expiresAt (as the loadOfflineManifest
    // tests above do) wouldn't reach this: appendOfflineRollCall checks the
    // *embedded* snapshot.expiresAt, a separate copy inside the encrypted
    // envelope. Record the first event against a normal, unexpired snapshot,
    // then re-save (carrying that event forward, as saveOfflineManifest
    // always does) against a trip whose endsAt is long past — the new
    // snapshot's expiresAt is now genuinely in the past, exactly as real
    // wall-clock expiry would leave it.
    const tripId = payload.manifests[0].trip.id;
    await saveOfflineManifest(payload);
    await appendOfflineRollCall(tripId, {
      bookingId: payload.manifests[0].divers[0].bookingId,
      checkpoint: "departure",
      status: "not_boarded",
      note: null,
    });
    const longOverTrip: OfflineManifestPayload = {
      ...payload,
      manifests: [
        {
          ...payload.manifests[0],
          trip: { ...payload.manifests[0].trip, endsAt: "2020-01-01T00:00:00.000Z" },
        },
      ],
    };
    await saveOfflineManifest(longOverTrip);

    await expect(
      appendOfflineRollCall(tripId, {
        bookingId: payload.manifests[0].divers[0].bookingId,
        checkpoint: "departure",
        status: "boarded",
        note: null,
      }),
    ).rejects.toThrow(/expired/);

    // The earlier pending event survives untouched — refusing a new one
    // doesn't discard evidence already recorded.
    const reloaded = await loadOfflineManifest(tripId);
    expect(reloaded?.events).toHaveLength(1);
  });
});

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
      /couldn't be checked against the live manifest/,
    );

    const reloaded = await loadOfflineManifest(payload.manifests[0].trip.id);
    expect(reloaded?.events[0].syncStatus).toBe("pending");
  });
});
