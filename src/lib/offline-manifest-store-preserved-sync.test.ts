// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { withRefreshedSyncFrame } from "@/test/offline-sync-frame";
import {
  appendOfflineRollCall,
  beginOfflineTenantVerificationRound,
  loadOfflineManifest,
  readOfflineManifestInventory,
  saveOfflineManifest,
  syncOfflineManifest,
} from "./offline-manifest-store";
import type { OfflineManifestPayload, OfflineRollCallEvent } from "./offline-manifests";

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
afterAll(() => server.close());
afterEach(async () => {
  server.resetHandlers();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("diveday-offline-manifests");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

it("keeps an ordinary pending event recoverable if an old writer replaces the key after save", async () => {
  const tripId = payload.manifests[0].trip.id;
  await saveOfflineManifest(payload);
  await appendOfflineRollCall(tripId, {
    bookingId: payload.manifests[0].divers[0].bookingId,
    checkpoint: "after_dive_1",
    status: "not_boarded",
  });
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const replacement = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("keys", "readwrite");
      tx.objectStore("keys").put(replacement, "manifest-aes-gcm-v1");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    expect((await loadOfflineManifest(tripId))?.events[0].syncStatus).toBe("pending");
  } finally {
    db.close();
  }
});

it("preserves an ordinary pending event if the key changes during a snapshot save", async () => {
  const tripId = payload.manifests[0].trip.id;
  await saveOfflineManifest(payload);
  await appendOfflineRollCall(tripId, {
    bookingId: payload.manifests[0].divers[0].bookingId,
    checkpoint: "after_dive_1",
    status: "not_boarded",
  });
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const read = (store: string, key: string) =>
    new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(store, "readonly").objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  const priorKey = await read("keys", "manifest-aes-gcm-v1");
  const priorRecord = await read("manifests", tripId);
  const replacement = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const spy = vi.spyOn(crypto.subtle, "encrypt").mockImplementation((async (
    ...args: Parameters<typeof crypto.subtle.encrypt>
  ) => {
    if ("additionalData" in (args[0] as AesGcmParams)) {
      entered();
      await barrier;
    }
    return encrypt(...args);
  }) as typeof crypto.subtle.encrypt);
  const replaceKey = (key: unknown) =>
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction("keys", "readwrite");
      tx.objectStore("keys").put(key, "manifest-aes-gcm-v1");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  try {
    const saving = saveOfflineManifest(payload);
    const outcome = saving.catch((error: unknown) => error);
    await started;
    await replaceKey(replacement);
    release();
    expect(await outcome).toMatchObject({ code: "write_conflict" });
    expect(await read("manifests", tripId)).toEqual(priorRecord);
    await replaceKey(priorKey);
    expect((await loadOfflineManifest(tripId))?.events[0].syncStatus).toBe("pending");
  } finally {
    release();
    spy.mockRestore();
    db.close();
  }
});

it("keeps the queued event pending when an active copy cannot be read", async () => {
  const tripId = payload.manifests[0].trip.id;
  await saveOfflineManifest(payload);
  await appendOfflineRollCall(tripId, {
    bookingId: payload.manifests[0].divers[0].bookingId,
    checkpoint: "after_dive_1",
    status: "not_boarded",
  });
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("manifests", "readwrite");
      tx.objectStore("manifests").put({
        tripId: "unreadable",
        expiresAt: "2099-01-01T00:00:00Z",
        iv: new Uint8Array(12).buffer,
        ciphertext: new Uint8Array([1, 2]).buffer,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    server.use(
      http.post("/api/offline-manifests/sync", async ({ request }) => {
        const posted = (await request.json()) as { events: OfflineRollCallEvent[] };
        return HttpResponse.json(
          withRefreshedSyncFrame(
            payload,
            {
              results: posted.events.map((event) => ({
                clientEventId: event.clientEventId,
                status: "applied",
              })),
            },
            { events: posted.events },
          ),
        );
      }),
    );
    await expect(syncOfflineManifest(tripId, payload.shop.slug)).rejects.toMatchObject({
      code: "unavailable",
    });
    expect((await loadOfflineManifest(tripId))?.events[0].syncStatus).toBe("pending");
    expect((await readOfflineManifestInventory()).incomplete).toBe(true);
  } finally {
    db.close();
  }
});

it("syncs a verified readable trip while preserving the warning for an opaque copy", async () => {
  const tripId = payload.manifests[0].trip.id;
  await saveOfflineManifest(payload);
  const queued = await appendOfflineRollCall(tripId, {
    bookingId: payload.manifests[0].divers[0].bookingId,
    checkpoint: "after_dive_1",
    status: "not_boarded",
  });
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("keys", "readwrite");
      tx.objectStore("keys").put(
        { ciphertext: new Uint8Array([1, 2, 3]).buffer },
        "unreadable-preservation-v1:unknown-copy",
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    server.use(
      http.post("/api/offline-manifests/sync", async ({ request }) => {
        const posted = (await request.json()) as { events: OfflineRollCallEvent[] };
        return HttpResponse.json(
          withRefreshedSyncFrame(
            payload,
            {
              results: posted.events.map((event) => ({
                clientEventId: event.clientEventId,
                status: "applied",
              })),
            },
            { events: posted.events },
          ),
        );
      }),
    );
    const synced = await syncOfflineManifest(tripId, payload.shop.slug);
    expect(
      synced?.events.find((event) => event.clientEventId === queued.events[0].clientEventId)
        ?.syncStatus,
    ).toBe("applied");
    expect((await readOfflineManifestInventory()).incomplete).toBe(true);
  } finally {
    db.close();
  }
});

it.each([
  "inventory",
  "legacy-writer",
  "legacy-replace",
  "legacy-delete",
  "legacy-key",
  "proof-failure",
  "proof-stall",
  "tenant",
] as const)("does not settle if %s changes after the preserved-only check", async (change) => {
  const tripId = payload.manifests[0].trip.id;
  await saveOfflineManifest(payload);
  await appendOfflineRollCall(tripId, {
    bookingId: payload.manifests[0].divers[0].bookingId,
    checkpoint: "after_dive_1",
    status: "not_boarded",
  });
  const otherId = "33333333-3333-4333-8333-333333333333";
  const replacementKey =
    change === "legacy-key"
      ? await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
          "encrypt",
          "decrypt",
        ])
      : null;
  if (change === "legacy-replace" || change === "legacy-delete") {
    const other = structuredClone(payload);
    other.manifests[0].trip.id = otherId;
    await saveOfflineManifest(other);
  }
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("keys", "readwrite");
      tx.objectStore("keys").put(
        { ciphertext: new Uint8Array([1]).buffer },
        "unreadable-preservation-v1:race",
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    server.use(
      http.post("/api/offline-manifests/sync", async ({ request }) => {
        const posted = (await request.json()) as { events: OfflineRollCallEvent[] };
        return HttpResponse.json(
          withRefreshedSyncFrame(
            payload,
            {
              results: posted.events.map((event) => ({
                clientEventId: event.clientEventId,
                status: "applied",
              })),
            },
            { events: posted.events },
          ),
        );
      }),
    );
    const original = crypto.subtle.encrypt.bind(crypto.subtle);
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let matchingEncryptions = 0;
    const spy = vi.spyOn(crypto.subtle, "encrypt").mockImplementation((async (
      ...args: Parameters<typeof crypto.subtle.encrypt>
    ) => {
      if (!("additionalData" in (args[0] as AesGcmParams))) {
        if (change === "proof-failure") throw new Error("proof unavailable");
        if (change === "proof-stall") return new Promise<ArrayBuffer>(() => {});
        return original(...args);
      }
      const data = JSON.parse(new TextDecoder().decode(args[2])) as {
        snapshot: { manifests: { trip: { id: string } }[] };
      };
      if (
        data.snapshot.manifests[0].trip.id === tripId &&
        ++matchingEncryptions === (change === "legacy-key" ? 2 : 1)
      ) {
        entered();
        await barrier;
      }
      return original(...args);
    }) as typeof crypto.subtle.encrypt);
    try {
      const syncing = syncOfflineManifest(tripId, payload.shop.slug);
      const outcome = syncing.catch((error: unknown) => error);
      await started;
      const originalRecord =
        change === "legacy-key"
          ? await new Promise<unknown>((resolve, reject) => {
              const request = db
                .transaction("manifests", "readonly")
                .objectStore("manifests")
                .get(tripId);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            })
          : undefined;
      const originalKey =
        change === "legacy-key"
          ? await new Promise<unknown>((resolve, reject) => {
              const request = db
                .transaction("keys", "readonly")
                .objectStore("keys")
                .get("manifest-aes-gcm-v1");
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            })
          : undefined;
      if (change === "inventory") {
        const other = structuredClone(payload);
        other.manifests[0].trip.id = "33333333-3333-4333-8333-333333333333";
        await saveOfflineManifest(other);
      } else if (change === "legacy-writer") {
        // An older v2 shell does not update the newer inventory generation.
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("manifests", "readwrite");
          tx.objectStore("manifests").put({
            tripId: "legacy-unreadable",
            expiresAt: "2099-01-01T00:00:00Z",
            iv: new Uint8Array(12).buffer,
            ciphertext: new Uint8Array([1, 2]).buffer,
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } else if (change === "legacy-replace" || change === "legacy-delete") {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("manifests", "readwrite");
          const store = tx.objectStore("manifests");
          if (change === "legacy-delete") store.delete(otherId);
          else {
            const read = store.get(otherId);
            read.onsuccess = () =>
              store.put({ ...read.result, ciphertext: new Uint8Array([3]).buffer });
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } else if (change === "legacy-key") {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("keys", "readwrite");
          tx.objectStore("keys").put(replacementKey, "manifest-aes-gcm-v1");
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } else if (change === "tenant") {
        await beginOfflineTenantVerificationRound();
      }
      release();
      if (change === "legacy-key") {
        await outcome;
        const currentRecord = await new Promise<unknown>((resolve, reject) => {
          const tx = db.transaction("manifests", "readonly");
          const request = tx.objectStore("manifests").get(tripId);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        expect(currentRecord).toEqual(originalRecord);
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("keys", "readwrite");
          tx.objectStore("keys").put(originalKey, "manifest-aes-gcm-v1");
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
      expect(await outcome).toMatchObject({
        code: change === "tenant" ? "shop_changed" : "write_conflict",
      });
      expect((await loadOfflineManifest(tripId))?.events[0].syncStatus).toBe("pending");
      expect((await readOfflineManifestInventory()).incomplete).toBe(true);
    } finally {
      release();
      spy.mockRestore();
    }
  } finally {
    db.close();
  }
});
