// @vitest-environment jsdom
// Browser-side store: the medical alerts' words on a device copy (H-20261023-medical-alert-for-the amendment).
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetThisDevice } from "@/components/forget-device";
import {
  appendOfflineRollCall,
  listOfflineManifests,
  loadOfflineManifest,
  saveOfflineManifest,
  saveOfflineMedicalAlerts,
  wipeOfflineMedicalAlerts,
} from "./offline-manifest-store";
import {
  type OfflineManifestPayload,
  offlineManifestMayHoldMedicalAlertWords,
} from "./offline-manifests";

const ALERT = "Bee-sting allergy. EpiPen in the blue dry bag.";
const ALERTED = "22222222-2222-2222-2222-222222222222";
const PLAIN = "55555555-5555-5555-5555-555555555555";
const DIVEMASTER = {
  personId: "66666666-6666-6666-6666-666666666666",
  name: "Yusra Idrissi",
  savedAt: "2026-07-31T11:00:00.000Z",
};

function diver(bookingId: string, fullName: string, alerted: boolean) {
  return {
    bookingId,
    fullName,
    email: null,
    emergencyContactName: "Sam Quinn",
    emergencyContactPhone: "+1-305-555-0100",
    readiness: { status: "ready" as const, blockers: [] },
    rentalFit: { state: "not_recorded" as const },
    nitroxRequested: false,
    rollCall: undefined,
    ...(alerted ? { medicalAlert: {} } : {}),
  };
}

function payloadFor(tripId: string): OfflineManifestPayload {
  return {
    shop: { slug: "blue-mantis", name: "Blue Mantis Divers", timezone: "America/New_York" },
    manifests: [
      {
        trip: {
          id: tripId,
          title: "Morning Two-Tank — Molasses Reef",
          startsAt: "2026-08-01T13:00:00.000Z",
          endsAt: "2026-08-01T16:30:00.000Z",
          plannedDives: 2,
        },
        checkpoint: "departure",
        crew: [],
        divers: [diver(ALERTED, "Siobhan Doyle", true), diver(PLAIN, "Nora Quinn", false)],
        summary: {
          totalDivers: 2,
          ready: 2,
          blocked: 0,
          boarded: 0,
          notBoarded: 0,
          notBackAboard: 0,
          awaiting: 2,
          unaccountedFor: 2,
          overCapacity: 0,
          notHere: 0,
        },
      },
    ],
  };
}

const TRIP = "11111111-1111-1111-1111-111111111111";
const OTHER_TRIP = "33333333-3333-3333-3333-333333333333";

afterEach(
  () =>
    new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("diveday-offline-manifests");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("failed to reset IndexedDB"));
    }),
);

const words = (envelope: Awaited<ReturnType<typeof loadOfflineManifest>>) =>
  envelope?.snapshot.manifests[0]?.divers.map((row) => row.medicalAlert);

describe("the medical alerts' words on a device copy", () => {
  it("wipes alerts from a readable preserved copy while keeping queued evidence", async () => {
    await saveOfflineManifest(payloadFor(TRIP));
    await saveOfflineMedicalAlerts(TRIP, { [ALERTED]: ALERT }, DIVEMASTER);
    await appendOfflineRollCall(TRIP, {
      bookingId: ALERTED,
      checkpoint: "departure",
      status: "boarded",
    });
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("diveday-offline-manifests", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const archiveKey = "unreadable-preservation-v1:test-copy";
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["keys", "manifests"], "readwrite");
        const keys = tx.objectStore("keys");
        const keyRequest = keys.get("manifest-aes-gcm-v1");
        const recordRequest = tx.objectStore("manifests").get(TRIP);
        let key: unknown;
        let record: unknown;
        let ready = 0;
        const save = () => {
          if (++ready === 2)
            keys.add(
              {
                record,
                observedKey: key,
                aad: new TextEncoder().encode(`4:${TRIP}`).buffer,
                version: 4,
              },
              archiveKey,
            );
        };
        keyRequest.onsuccess = () => {
          key = keyRequest.result;
          save();
        };
        recordRequest.onsuccess = () => {
          record = recordRequest.result;
          save();
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      const results = await Promise.allSettled([
        wipeOfflineMedicalAlerts(DIVEMASTER.personId),
        wipeOfflineMedicalAlerts(),
      ]);
      expect(results.every((result) => result.status === "rejected")).toBe(true);
      const saved = await new Promise<{
        record: { iv: ArrayBuffer; ciphertext: ArrayBuffer };
        observedKey: CryptoKey;
        aad: ArrayBuffer;
        keyId: string;
        revision: number;
      }>((resolve, reject) => {
        const request = db.transaction("keys").objectStore("keys").get(archiveKey);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      expect(saved.observedKey).toBeInstanceOf(CryptoKey);
      expect(saved.keyId).toBeTruthy();
      expect(saved.revision).toBe(1);
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: saved.record.iv, additionalData: saved.aad },
        saved.observedKey,
        saved.record.ciphertext,
      );
      const copy = JSON.parse(new TextDecoder().decode(plaintext));
      expect(JSON.stringify(copy)).not.toContain("EpiPen");
      expect(copy.events).toHaveLength(1);
      expect(copy.events[0].syncStatus).toBe("pending");
    } finally {
      db.close();
    }
  });
  it("retains opaque preserved bytes and reports incomplete when no key is available", async () => {
    await saveOfflineManifest(payloadFor(TRIP));
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("diveday-offline-manifests", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const key = "unreadable-preservation-v1:no-key";
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("keys", "readwrite");
        tx.objectStore("keys").put(
          {
            observedKey: null,
            aad: new Uint8Array([1]).buffer,
            record: {
              tripId: "unknown",
              expiresAt: "2099-01-01T00:00:00Z",
              iv: new Uint8Array(12).buffer,
              ciphertext: new Uint8Array([9, 8, 7]).buffer,
            },
          },
          key,
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      await expect(wipeOfflineMedicalAlerts()).rejects.toMatchObject({ code: "unavailable" });
      const retained = await new Promise<{ record: { ciphertext: ArrayBuffer } }>(
        (resolve, reject) => {
          const request = db.transaction("keys").objectStore("keys").get(key);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        },
      );
      expect([...new Uint8Array(retained.record.ciphertext)]).toEqual([9, 8, 7]);
    } finally {
      db.close();
    }
  });
  it("wipes the live copy even if preserved-copy encryption fails", async () => {
    await saveOfflineManifest(payloadFor(TRIP));
    await saveOfflineMedicalAlerts(TRIP, { [ALERTED]: ALERT }, DIVEMASTER);
    await appendOfflineRollCall(TRIP, {
      bookingId: ALERTED,
      checkpoint: "departure",
      status: "boarded",
    });
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("diveday-offline-manifests", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["keys", "manifests"], "readwrite");
        const keys = tx.objectStore("keys");
        const keyRequest = keys.get("manifest-aes-gcm-v1");
        const recordRequest = tx.objectStore("manifests").get(TRIP);
        let key: unknown;
        let record: unknown;
        let ready = 0;
        const save = () => {
          if (++ready === 2)
            keys.add(
              {
                record,
                observedKey: key,
                aad: new TextEncoder().encode(`4:${TRIP}`).buffer,
                version: 4,
                keyId: "candidate-1",
                revision: 0,
              },
              "unreadable-preservation-v1:failure",
            );
        };
        keyRequest.onsuccess = () => {
          key = keyRequest.result;
          save();
        };
        recordRequest.onsuccess = () => {
          record = recordRequest.result;
          save();
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      await appendOfflineRollCall(TRIP, {
        bookingId: PLAIN,
        checkpoint: "departure",
        status: "boarded",
      });
      const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
      const spy = vi.spyOn(crypto.subtle, "encrypt").mockImplementation((async (
        ...args: Parameters<typeof crypto.subtle.encrypt>
      ) => {
        if (!("additionalData" in (args[0] as AesGcmParams))) return encrypt(...args);
        const text = new TextDecoder().decode(args[2]);
        const eventCount = (JSON.parse(text) as { events: unknown[] }).events.length;
        if (eventCount === 1) throw new Error("preserved copy storage failure");
        return encrypt(...args);
      }) as typeof crypto.subtle.encrypt);
      try {
        await expect(wipeOfflineMedicalAlerts()).rejects.toThrow("preserved copy storage failure");
        const current = await loadOfflineManifest(TRIP);
        expect(JSON.stringify(current)).not.toContain("EpiPen");
        expect(current?.events).toHaveLength(2);
      } finally {
        spy.mockRestore();
      }
      await saveOfflineMedicalAlerts(TRIP, { [ALERTED]: ALERT }, DIVEMASTER);
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const stalled = vi.spyOn(crypto.subtle, "encrypt").mockImplementation((async (
        ...args: Parameters<typeof crypto.subtle.encrypt>
      ) => {
        if (!("additionalData" in (args[0] as AesGcmParams))) return encrypt(...args);
        const eventCount = (JSON.parse(new TextDecoder().decode(args[2])) as { events: unknown[] })
          .events.length;
        if (eventCount === 1) {
          entered();
          await barrier;
        }
        return encrypt(...args);
      }) as typeof crypto.subtle.encrypt);
      try {
        const wiping = wipeOfflineMedicalAlerts();
        await started;
        await vi.waitFor(async () =>
          expect(JSON.stringify(await loadOfflineManifest(TRIP))).not.toContain("EpiPen"),
        );
        const replacementKey = await crypto.subtle.generateKey(
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"],
        );
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("keys", "readwrite");
          const store = tx.objectStore("keys");
          const request = store.get("unreadable-preservation-v1:failure");
          request.onsuccess = () =>
            store.put(
              { ...request.result, observedKey: replacementKey, keyId: "candidate-2" },
              "unreadable-preservation-v1:failure",
            );
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        release();
        await expect(wiping).rejects.toMatchObject({ code: "unavailable" });
        const currentArchive = await new Promise<{ keyId: string; revision: number }>(
          (resolve, reject) => {
            const request = db
              .transaction("keys")
              .objectStore("keys")
              .get("unreadable-preservation-v1:failure");
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          },
        );
        expect(currentArchive).toMatchObject({ keyId: "candidate-2", revision: 0 });
      } finally {
        release();
        stalled.mockRestore();
      }
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("keys", "readwrite");
        const store = tx.objectStore("keys");
        const keyRequest = store.get("manifest-aes-gcm-v1");
        const archiveRequest = store.get("unreadable-preservation-v1:failure");
        let key: unknown;
        let archive: Record<string, unknown>;
        let ready = 0;
        const restore = () => {
          if (++ready === 2)
            store.put(
              { ...archive, observedKey: key, keyId: "restored", revision: 0 },
              "unreadable-preservation-v1:failure",
            );
        };
        keyRequest.onsuccess = () => {
          key = keyRequest.result;
          restore();
        };
        archiveRequest.onsuccess = () => {
          archive = archiveRequest.result;
          restore();
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      let startedRetry!: () => void;
      let continueRetry!: () => void;
      const retryStarted = new Promise<void>((resolve) => {
        startedRetry = resolve;
      });
      const retryBarrier = new Promise<void>((resolve) => {
        continueRetry = resolve;
      });
      let paused = false;
      const retrySpy = vi.spyOn(crypto.subtle, "encrypt").mockImplementation((async (
        ...args: Parameters<typeof crypto.subtle.encrypt>
      ) => {
        const count = (JSON.parse(new TextDecoder().decode(args[2])) as { events: unknown[] })
          .events.length;
        if (count === 1 && !paused) {
          paused = true;
          startedRetry();
          await retryBarrier;
        }
        return encrypt(...args);
      }) as typeof crypto.subtle.encrypt);
      try {
        const wiping = wipeOfflineMedicalAlerts();
        await retryStarted;
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("keys", "readwrite");
          const store = tx.objectStore("keys");
          const request = store.get("unreadable-preservation-v1:failure");
          request.onsuccess = () =>
            store.put({ ...request.result, revision: 1 }, "unreadable-preservation-v1:failure");
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        continueRetry();
        await expect(wiping).rejects.toMatchObject({ code: "unavailable" });
        const saved = await new Promise<{
          record: { iv: ArrayBuffer; ciphertext: ArrayBuffer };
          observedKey: CryptoKey;
          aad: ArrayBuffer;
          revision: number;
        }>((resolve, reject) => {
          const request = db
            .transaction("keys")
            .objectStore("keys")
            .get("unreadable-preservation-v1:failure");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        expect(saved.revision).toBe(2);
        const plaintext = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: saved.record.iv, additionalData: saved.aad },
          saved.observedKey,
          saved.record.ciphertext,
        );
        const copy = JSON.parse(new TextDecoder().decode(plaintext));
        expect(JSON.stringify(copy)).not.toContain("EpiPen");
        expect(copy.events).toHaveLength(1);
      } finally {
        continueRetry();
        retrySpy.mockRestore();
      }
    } finally {
      db.close();
    }
  });
  it("wipes readable copies while reporting an unreadable copy needs attention", async () => {
    await saveOfflineManifest(payloadFor(TRIP));
    await saveOfflineMedicalAlerts(TRIP, { [ALERTED]: ALERT }, DIVEMASTER);
    await appendOfflineRollCall(TRIP, {
      bookingId: ALERTED,
      checkpoint: "departure",
      status: "boarded",
    });
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("diveday-offline-manifests", 2);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("manifests", "readwrite");
        transaction.objectStore("manifests").put({
          tripId: OTHER_TRIP,
          expiresAt: "2099-01-01T00:00:00.000Z",
          iv: new Uint8Array(12).buffer,
          ciphertext: new Uint8Array([1, 2, 3]).buffer,
        });
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });
    await expect(wipeOfflineMedicalAlerts()).rejects.toMatchObject({ code: "unavailable" });
    const readable = await loadOfflineManifest(TRIP);
    expect(JSON.stringify(readable)).not.toContain("EpiPen");
    expect(readable?.events).toHaveLength(1);
    expect(readable?.events[0].syncStatus).toBe("pending");
  });
  it("retries a wipe after a concurrent roll-call write without losing the queued event", async () => {
    await saveOfflineManifest(payloadFor(TRIP));
    await saveOfflineMedicalAlerts(TRIP, { [ALERTED]: ALERT }, DIVEMASTER);
    const previous = Object.getOwnPropertyDescriptor(navigator, "locks");
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    let start!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    const spy = vi.spyOn(crypto.subtle, "encrypt").mockImplementation((async (
      ...args: Parameters<typeof crypto.subtle.encrypt>
    ) => {
      if (first) {
        first = false;
        start();
        await barrier;
      }
      return encrypt(...args);
    }) as typeof crypto.subtle.encrypt);
    try {
      const wipe = wipeOfflineMedicalAlerts();
      await started;
      await appendOfflineRollCall(TRIP, {
        bookingId: ALERTED,
        checkpoint: "departure",
        status: "boarded",
      });
      release();
      await expect(wipe).resolves.toBeUndefined();
      const saved = await loadOfflineManifest(TRIP);
      expect(JSON.stringify(saved)).not.toContain("EpiPen");
      expect(saved?.events).toHaveLength(1);
      expect(saved?.events[0].syncStatus).toBe("pending");
    } finally {
      release();
      spy.mockRestore();
      if (previous) Object.defineProperty(navigator, "locks", previous);
      else Reflect.deleteProperty(navigator, "locks");
    }
  });
  it("refuses a medical save already in flight when sign-out advances the device round", async () => {
    await saveOfflineManifest(payloadFor(TRIP));
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    let start!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi.spyOn(crypto.subtle, "encrypt").mockImplementation((async (
      ...args: Parameters<typeof crypto.subtle.encrypt>
    ) => {
      start();
      await barrier;
      return encrypt(...args);
    }) as typeof crypto.subtle.encrypt);
    try {
      const save = saveOfflineMedicalAlerts(TRIP, { [ALERTED]: ALERT }, DIVEMASTER);
      await started;
      await forgetThisDevice();
      release();
      await expect(save).rejects.toMatchObject({ code: "write_conflict" });
      expect(JSON.stringify(await loadOfflineManifest(TRIP))).not.toContain("EpiPen");
    } finally {
      release();
      spy.mockRestore();
    }
  });
  it("never keeps words a payload carried: only an explicit save puts them on", async () => {
    const payload = payloadFor(TRIP);
    const smuggled = structuredClone(payload);
    const first = smuggled.manifests[0]?.divers[0];
    if (first) first.medicalAlert = { text: ALERT };
    const saved = await saveOfflineManifest(smuggled);
    expect(JSON.stringify(saved)).not.toContain("EpiPen");
    expect(saved.medicalAlertsSavedBy).toBeUndefined();
  });

  it("puts the words on flagged divers only, and records who saved them", async () => {
    await saveOfflineManifest(payloadFor(TRIP));
    const saved = await saveOfflineMedicalAlerts(
      TRIP,
      { [ALERTED]: ALERT, [PLAIN]: "never flagged, never carried" },
      DIVEMASTER,
    );
    expect(words(saved)).toEqual([{ text: ALERT }, undefined]);
    expect(saved?.medicalAlertsSavedBy).toEqual(DIVEMASTER);
    expect(words(await loadOfflineManifest(TRIP))).toEqual([{ text: ALERT }, undefined]);
  });

  it("has nothing to put words on before the copy exists", async () => {
    expect(await saveOfflineMedicalAlerts(TRIP, { [ALERTED]: ALERT }, DIVEMASTER)).toBeNull();
    expect(await loadOfflineManifest(TRIP)).toBeNull();
  });

  it("keeps the saved words through a background refresh, for a diver still flagged", async () => {
    await saveOfflineManifest(payloadFor(TRIP));
    await saveOfflineMedicalAlerts(TRIP, { [ALERTED]: ALERT }, DIVEMASTER);
    const refreshed = await saveOfflineManifest(payloadFor(TRIP));
    expect(words(refreshed)).toEqual([{ text: ALERT }, undefined]);
    expect(refreshed.medicalAlertsSavedBy).toEqual(DIVEMASTER);
    // The diver re-signed with no alert: the board drops the flag, and the
    // words go with it.
    const cleared = payloadFor(TRIP);
    const row = cleared.manifests[0]?.divers[0];
    if (row) delete row.medicalAlert;
    const after = await saveOfflineManifest(cleared);
    expect(JSON.stringify(after)).not.toContain("EpiPen");
    expect(after.medicalAlertsSavedBy).toBeUndefined();
  });

  it("drops the saved words on a background refresh once the viewer may no longer hold them (security review 2, L3)", async () => {
    await saveOfflineManifest(payloadFor(TRIP));
    await saveOfflineMedicalAlerts(TRIP, { [ALERTED]: ALERT }, DIVEMASTER);
    // Still on the crew: the refresh keeps them.
    const crewing = { payloads: [], mayHoldMedicalAlertWords: { [TRIP]: true } };
    const kept = await saveOfflineManifest(payloadFor(TRIP), {
      keepMedicalAlertWords: offlineManifestMayHoldMedicalAlertWords(crewing, TRIP),
    });
    expect(words(kept)).toEqual([{ text: ALERT }, undefined]);
    // Taken off the boat: the next refresh drops the words, keeps the fact.
    const removed = { payloads: [], mayHoldMedicalAlertWords: { [TRIP]: false } };
    const after = await saveOfflineManifest(payloadFor(TRIP), {
      keepMedicalAlertWords: offlineManifestMayHoldMedicalAlertWords(removed, TRIP),
    });
    expect(JSON.stringify(after)).not.toContain("EpiPen");
    expect(after.medicalAlertsSavedBy).toBeUndefined();
    expect(words(after)).toEqual([{}, undefined]);
    expect(JSON.stringify(await loadOfflineManifest(TRIP))).not.toContain("EpiPen");
  });

  it("reads a missing or malformed answer as may not hold them", () => {
    expect(offlineManifestMayHoldMedicalAlertWords({}, TRIP)).toBe(false);
    expect(offlineManifestMayHoldMedicalAlertWords(null, TRIP)).toBe(false);
    expect(
      offlineManifestMayHoldMedicalAlertWords(
        { mayHoldMedicalAlertWords: { [TRIP]: "yes" } },
        TRIP,
      ),
    ).toBe(false);
    expect(
      offlineManifestMayHoldMedicalAlertWords(
        { mayHoldMedicalAlertWords: { [TRIP]: true } },
        OTHER_TRIP,
      ),
    ).toBe(false);
    expect(
      offlineManifestMayHoldMedicalAlertWords(
        { mayHoldMedicalAlertWords: { [TRIP]: true } },
        undefined,
      ),
    ).toBe(false);
  });

  it("wipes the words from every copy on sign-out, keeping the rest of each copy", async () => {
    await saveOfflineManifest(payloadFor(TRIP));
    await saveOfflineManifest(payloadFor(OTHER_TRIP));
    await saveOfflineMedicalAlerts(TRIP, { [ALERTED]: ALERT }, DIVEMASTER);
    await saveOfflineMedicalAlerts(OTHER_TRIP, { [ALERTED]: ALERT }, DIVEMASTER);
    // A roll call taken at sea and not yet synced must survive the wipe.
    await appendOfflineRollCall(TRIP, {
      bookingId: ALERTED,
      checkpoint: "departure",
      status: "boarded",
    });

    await wipeOfflineMedicalAlerts();

    const copies = await listOfflineManifests();
    expect(copies).toHaveLength(2);
    expect(JSON.stringify(copies)).not.toContain("EpiPen");
    for (const copy of copies) {
      expect(copy.medicalAlertsSavedBy).toBeUndefined();
      // The fact stays, so the chip still shows.
      expect(words(copy)).toEqual([{}, undefined]);
      expect(copy.snapshot.manifests[0]?.divers[0]?.emergencyContactPhone).toBe("+1-305-555-0100");
    }
    const tripCopy = copies.find((copy) => copy.snapshot.manifests[0]?.trip.id === TRIP);
    expect(tripCopy?.events.map((event) => event.status)).toEqual(["boarded"]);
  });

  it("wipes another person's words when someone else signs in, and keeps the signed-in person's own", async () => {
    await saveOfflineManifest(payloadFor(TRIP));
    await saveOfflineManifest(payloadFor(OTHER_TRIP));
    await saveOfflineMedicalAlerts(TRIP, { [ALERTED]: ALERT }, DIVEMASTER);
    const captain = { ...DIVEMASTER, personId: "77777777-7777-7777-7777-777777777777" };
    await saveOfflineMedicalAlerts(OTHER_TRIP, { [ALERTED]: ALERT }, captain);

    await wipeOfflineMedicalAlerts(captain.personId);

    expect(words(await loadOfflineManifest(TRIP))).toEqual([{}, undefined]);
    expect((await loadOfflineManifest(TRIP))?.medicalAlertsSavedBy).toBeUndefined();
    const kept = await loadOfflineManifest(OTHER_TRIP);
    expect(words(kept)).toEqual([{ text: ALERT }, undefined]);
    expect(kept?.medicalAlertsSavedBy).toEqual(captain);
  });

  it("is what signing out runs (`forgetThisDevice`, both sign-out doors and the sign-in page)", async () => {
    await saveOfflineManifest(payloadFor(TRIP));
    await saveOfflineMedicalAlerts(TRIP, { [ALERTED]: ALERT }, DIVEMASTER);
    // Awaitable (security review 2, L4): both sign-out doors wait for it.
    await forgetThisDevice();
    expect((await loadOfflineManifest(TRIP))?.medicalAlertsSavedBy).toBeUndefined();
    expect(JSON.stringify(await loadOfflineManifest(TRIP))).not.toContain("EpiPen");
  });
});
