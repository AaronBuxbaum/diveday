// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { rawStoredRecord } from "@/test/offline-raw-record";
import {
  beginOfflineTenantVerificationRound,
  loadOfflineManifest,
  purgeOfflineManifestsExceptShop,
  saveOfflineManifest,
} from "./offline-manifest-store";
import type { OfflineManifestPayload } from "./offline-manifests";

function payload(id: string): OfflineManifestPayload {
  return {
    shop: {
      slug: "blue-mantis",
      name: "Blue Mantis",
      timezone: "UTC",
      emergencyReference: { lines: [], vessel: "", shoreContact: "", plan: "" },
    },
    manifests: [
      {
        trip: {
          id,
          title: id,
          startsAt: "2026-08-01T13:00:00.000Z",
          endsAt: "2026-08-01T16:30:00.000Z",
          plannedDives: 1,
        },
        checkpoint: "departure",
        crew: [],
        divers: [],
        summary: {
          totalDivers: 0,
          ready: 0,
          blocked: 0,
          boarded: 0,
          notBoarded: 0,
          notBackAboard: 0,
          awaiting: 0,
          unaccountedFor: 0,
          overCapacity: 0,
          notHere: 0,
        },
      },
    ],
  };
}

afterEach(
  () =>
    new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("diveday-offline-manifests");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }),
);

it.each(["ciphertext", "iv", "unknown field"] as const)(
  "does not purge an older shell replacement that changes %s",
  async (change) => {
    const tripId = "foreign-copy";
    await saveOfflineManifest(payload(tripId));
    const round = await beginOfflineTenantVerificationRound();
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    const spy = vi.spyOn(crypto.subtle, "decrypt").mockImplementation((async (
      ...args: Parameters<typeof crypto.subtle.decrypt>
    ) => {
      const plaintext = await decrypt(...args);
      reads += 1;
      if (reads === 2) {
        entered();
        await barrier;
      }
      return plaintext;
    }) as typeof crypto.subtle.decrypt);
    try {
      const purging = purgeOfflineManifestsExceptShop("another-shop", round);
      await started;
      const existing = (await rawStoredRecord(tripId)) as Record<string, unknown>;
      const replacement =
        change === "ciphertext"
          ? { ...existing, ciphertext: new Uint8Array([1, 2, 3]).buffer }
          : change === "iv"
            ? { ...existing, iv: new Uint8Array(12).fill(1).buffer }
            : { ...existing, futureSafetyEvidence: "unknown" };
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("diveday-offline-manifests", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("manifests", "readwrite");
          tx.objectStore("manifests").put(replacement);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
      release();
      expect(await purging).toEqual([]);
      expect(await rawStoredRecord(tripId)).toEqual(replacement);
    } finally {
      release();
      spy.mockRestore();
    }
  },
);

it("uses the winning encryption key when two first saves generate keys without Web Locks", async () => {
  const prior = Object.getOwnPropertyDescriptor(navigator, "locks");
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  const generate = crypto.subtle.generateKey.bind(crypto.subtle);
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const spy = vi.spyOn(crypto.subtle, "generateKey").mockImplementation((async (
    ...args: Parameters<typeof crypto.subtle.generateKey>
  ) => {
    calls += 1;
    if (calls === 2) release();
    await barrier;
    return generate(...args);
  }) as typeof crypto.subtle.generateKey);
  try {
    await Promise.all([
      saveOfflineManifest(payload("trip-one")),
      saveOfflineManifest(payload("trip-two")),
    ]);
    expect(calls).toBe(2);
    expect((await loadOfflineManifest("trip-one"))?.snapshot.manifests[0].trip.id).toBe("trip-one");
    expect((await loadOfflineManifest("trip-two"))?.snapshot.manifests[0].trip.id).toBe("trip-two");
  } finally {
    spy.mockRestore();
    if (prior) Object.defineProperty(navigator, "locks", prior);
    else Reflect.deleteProperty(navigator, "locks");
  }
});

it("does not create a replacement key while an unreadable saved record remains", async () => {
  await saveOfflineManifest(payload("original"));
  const original = await new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 1);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(["keys", "manifests"], "readwrite");
      const get = transaction.objectStore("manifests").get("original");
      let record: unknown;
      get.onsuccess = () => {
        record = get.result;
      };
      transaction.objectStore("keys").delete("manifest-aes-gcm-v1");
      transaction.oncomplete = () => {
        db.close();
        resolve(record);
      };
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  });
  await expect(loadOfflineManifest("original")).rejects.toThrow();
  await expect(saveOfflineManifest(payload("new-trip"))).rejects.toThrow();
  const after = await new Promise<{ key: unknown; record: unknown }>((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 1);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(["keys", "manifests"], "readonly");
      const key = transaction.objectStore("keys").get("manifest-aes-gcm-v1");
      const record = transaction.objectStore("manifests").get("original");
      transaction.oncomplete = () => {
        db.close();
        resolve({ key: key.result, record: record.result });
      };
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  });
  expect(after.key).toBeUndefined();
  expect(after.record).toEqual(original);
});

it.each(["invalid key", "wrong algorithm", "preserved archive"] as const)(
  "does not replace uncertain key material when only an %s remains",
  async (caseName) => {
    const id =
      caseName === "preserved archive" ? "unreadable-preservation-v1:test" : "manifest-aes-gcm-v1";
    const value =
      caseName === "wrong algorithm"
        ? await crypto.subtle.generateKey({ name: "AES-CBC", length: 256 }, false, [
            "encrypt",
            "decrypt",
          ])
        : { unknown: "retain" };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("diveday-offline-manifests", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("keys");
        request.result.createObjectStore("manifests", { keyPath: "tripId" });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("keys", "readwrite");
        tx.objectStore("keys").put(value, id);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
    await expect(saveOfflineManifest(payload("fresh-trip"))).rejects.toMatchObject({
      code: "unavailable",
    });
    const stored = await new Promise<unknown>((resolve, reject) => {
      const request = indexedDB.open("diveday-offline-manifests", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("keys", "readonly");
        const read = tx.objectStore("keys").get(id);
        tx.oncomplete = () => {
          db.close();
          resolve(read.result);
        };
        tx.onerror = () => reject(tx.error);
      };
    });
    if (value instanceof CryptoKey) {
      expect(stored).toBeInstanceOf(CryptoKey);
      if (!(stored instanceof CryptoKey)) throw new Error("stored key missing");
      const iv = new Uint8Array(16);
      const bytes = new TextEncoder().encode("preserve key");
      const ciphertext = await crypto.subtle.encrypt({ name: "AES-CBC", iv }, value, bytes);
      expect(
        new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv }, stored, ciphertext)),
      ).toEqual(bytes);
    } else {
      expect(stored).toEqual(value);
    }
    expect(await rawStoredRecord("fresh-trip")).toBeUndefined();
  },
);
