// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { rawStoredRecord } from "@/test/offline-raw-record";
import {
  beginOfflineTenantVerificationRound,
  deleteOfflineManifest,
  listOfflineManifests,
  loadOfflineManifest,
  purgeOfflineManifestsExceptShop,
  readOfflineManifestInventory,
  recoverExactPreservedDuplicates,
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

it.each(["ciphertext", "unknown field"] as const)(
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
          : { ...existing, futureSafetyEvidence: "unknown" };
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("diveday-offline-manifests", 2);
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
    const request = indexedDB.open("diveday-offline-manifests", 2);
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
    const request = indexedDB.open("diveday-offline-manifests", 2);
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

it("refuses a stale concurrent save rather than overwriting the winning record", async () => {
  const prior = Object.getOwnPropertyDescriptor(navigator, "locks");
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  const id = "same-trip";
  await saveOfflineManifest(payload(id));
  const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const spy = vi.spyOn(crypto.subtle, "encrypt").mockImplementation((async (
    ...args: Parameters<typeof crypto.subtle.encrypt>
  ) => {
    calls += 1;
    if (calls === 2) release();
    await barrier;
    return encrypt(...args);
  }) as typeof crypto.subtle.encrypt);
  try {
    const first = payload(id);
    const second = payload(id);
    first.manifests[0].trip.title = "First";
    second.manifests[0].trip.title = "Second";
    const results = await Promise.allSettled([
      saveOfflineManifest(first),
      saveOfflineManifest(second),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const loser = results.find((result) => result.status === "rejected");
    expect(loser?.status === "rejected" && loser.reason).toMatchObject({ code: "write_conflict" });
    const winner = results.find((result) => result.status === "fulfilled");
    expect(winner?.status).toBe("fulfilled");
    if (winner?.status !== "fulfilled") throw new Error("missing winning save");
    expect((await loadOfflineManifest(id))?.snapshot.manifests[0].trip.title).toBe(
      winner.value.snapshot.manifests[0].trip.title,
    );
  } finally {
    spy.mockRestore();
    if (prior) Object.defineProperty(navigator, "locks", prior);
    else Reflect.deleteProperty(navigator, "locks");
  }
});

it("retains existing stores during upgrade", async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("keys");
      request.result.createObjectStore("manifests", { keyPath: "tripId" });
      request.transaction?.objectStore("keys").put("preserved", "sentinel");
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
  expect(await loadOfflineManifest("absent")).toBeNull();
  const preserved = await new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 2);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("keys", "readonly");
      const get = transaction.objectStore("keys").get("sentinel");
      get.onsuccess = () => resolve(get.result);
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  });
  expect(preserved).toBe("preserved");
});

it("does not upgrade later after a blocked open reported failure", async () => {
  const old = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("keys");
      request.result.createObjectStore("manifests", { keyPath: "tripId" });
      request.transaction?.objectStore("keys").put("preserved", "sentinel");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await expect(loadOfflineManifest("absent")).rejects.toMatchObject({ code: "unavailable" });
  } finally {
    old.close();
  }
  const stillOld = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    expect(stillOld.version).toBe(1);
    const sentinel = await new Promise<unknown>((resolve, reject) => {
      const request = stillOld.transaction("keys").objectStore("keys").get("sentinel");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(sentinel).toBe("preserved");
  } finally {
    stillOld.close();
  }
});

it("does not let a first save recreate a copy after its explicit deletion", async () => {
  const prior = Object.getOwnPropertyDescriptor(navigator, "locks");
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
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
    entered();
    await barrier;
    return encrypt(...args);
  }) as typeof crypto.subtle.encrypt);
  try {
    const save = saveOfflineManifest(payload("deleted-trip"));
    await started;
    expect(await deleteOfflineManifest("deleted-trip")).toBe(false);
    release();
    await expect(save).rejects.toThrow();
    expect(await loadOfflineManifest("deleted-trip")).toBeNull();
  } finally {
    release();
    spy.mockRestore();
    if (prior) Object.defineProperty(navigator, "locks", prior);
    else Reflect.deleteProperty(navigator, "locks");
  }
});

it("does not commit a started save after a newer tenant verification round", async () => {
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
    entered();
    await barrier;
    return encrypt(...args);
  }) as typeof crypto.subtle.encrypt);
  try {
    const save = saveOfflineManifest(payload("old-tenant-trip"));
    await started;
    await beginOfflineTenantVerificationRound();
    release();
    await expect(save).rejects.toMatchObject({ code: "write_conflict" });
    expect(await loadOfflineManifest("old-tenant-trip")).toBeNull();
  } finally {
    release();
    spy.mockRestore();
  }
});

it("shows readable copies while reporting that an unreadable inventory is incomplete", async () => {
  await saveOfflineManifest(payload("readable"));
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 2);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("manifests", "readwrite");
      transaction.objectStore("manifests").put({
        tripId: "unreadable",
        expiresAt: "2099-01-01T00:00:00.000Z",
        pendingEvents: 0,
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
  const inventory = await readOfflineManifestInventory();
  expect(inventory.incomplete).toBe(true);
  expect(inventory.manifests.map((entry) => entry.snapshot.manifests[0].trip.id)).toEqual([
    "readable",
  ]);
  expect(await deleteOfflineManifest("unreadable")).toBe(false);
  expect((await readOfflineManifestInventory()).incomplete).toBe(true);
  await expect(listOfflineManifests()).rejects.toThrow();
});

it("reports an existing preserved copy and refuses to replace a missing key", async () => {
  expect(await loadOfflineManifest("missing")).toBeNull();
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
        "unreadable-preservation-v1:seeded-copy",
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const inventory = await readOfflineManifestInventory();
    expect(inventory.manifests).toEqual([]);
    expect(inventory.incomplete).toBe(true);
    expect(await recoverExactPreservedDuplicates()).toBe(0);
    await expect(saveOfflineManifest(payload("new-copy"))).rejects.toThrow();
  } finally {
    db.close();
  }
});

it("retains a preserved duplicate until an authorized recovery accounts for it", async () => {
  await saveOfflineManifest(payload("same-copy"));
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
      const recordRequest = tx.objectStore("manifests").get("same-copy");
      let key: unknown;
      let record: unknown;
      let ready = 0;
      const save = () => {
        if (++ready === 2)
          keys.add(
            {
              record,
              observedKey: key,
              aad: new TextEncoder().encode("4:same-copy").buffer,
              version: 4,
              keyId: "same-key",
              revision: 0,
            },
            "unreadable-preservation-v1:same-copy",
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
    const inventory = await readOfflineManifestInventory();
    expect(inventory.manifests).toHaveLength(1);
    expect(inventory.incomplete).toBe(true);
  } finally {
    db.close();
  }
});

it("does not expire a copy while a guarded deletion is no longer current", async () => {
  await saveOfflineManifest(payload("expired-guarded"));
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("manifests", "readwrite");
      const store = transaction.objectStore("manifests");
      const request = store.get("expired-guarded");
      request.onsuccess = () =>
        store.put({ ...request.result, expiresAt: "2000-01-01T00:00:00.000Z" });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    const isCurrent = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    expect(await deleteOfflineManifest("expired-guarded", db, isCurrent)).toBe(false);
    const retained = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction("manifests").objectStore("manifests").get("expired-guarded");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(retained).toBeDefined();
  } finally {
    db.close();
  }
});

it("does not report a complete inventory when a trip appears during its reads", async () => {
  await saveOfflineManifest(payload("first"));
  const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const spy = vi.spyOn(crypto.subtle, "decrypt").mockImplementation((async (
    ...args: Parameters<typeof crypto.subtle.decrypt>
  ) => {
    if (!("additionalData" in (args[0] as AesGcmParams))) return decrypt(...args);
    entered();
    await barrier;
    return decrypt(...args);
  }) as typeof crypto.subtle.decrypt);
  try {
    const reading = readOfflineManifestInventory();
    await started;
    await saveOfflineManifest(payload("second"));
    release();
    const inventory = await reading;
    expect(inventory.incomplete).toBe(false);
    expect(inventory.manifests.map((entry) => entry.snapshot.manifests[0].trip.id).sort()).toEqual([
      "first",
      "second",
    ]);
  } finally {
    release();
    spy.mockRestore();
  }
});

it("reports incomplete inventory when an older writer inserts an unreadable row during a scan", async () => {
  await saveOfflineManifest(payload("first"));
  const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const spy = vi.spyOn(crypto.subtle, "decrypt").mockImplementation((async (
    ...args: Parameters<typeof crypto.subtle.decrypt>
  ) => {
    entered();
    await barrier;
    return decrypt(...args);
  }) as typeof crypto.subtle.decrypt);
  try {
    const reading = readOfflineManifestInventory();
    await started;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("diveday-offline-manifests", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
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
    } finally {
      db.close();
    }
    release();
    expect((await reading).incomplete).toBe(true);
  } finally {
    release();
    spy.mockRestore();
  }
});
