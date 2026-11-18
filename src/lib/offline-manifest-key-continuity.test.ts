// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { rawStoredRecord } from "@/test/offline-raw-record";
import { snapshot } from "@/test/substrate-fixtures/lib/offline-manifests-fixtures";
import {
  appendOfflineRollCall,
  loadOfflineManifest,
  saveOfflineManifest,
} from "./offline-manifest-store";

afterEach(
  () =>
    new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("diveday-offline-manifests");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }),
);

async function removeKey() {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("keys", "readwrite");
      tx.objectStore("keys").delete("manifest-aes-gcm-v1");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

async function replaceKey(value: unknown) {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("keys", "readwrite");
      tx.objectStore("keys").put(value, "manifest-aes-gcm-v1");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

async function readKey() {
  return new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("keys", "readonly");
      const get = tx.objectStore("keys").get("manifest-aes-gcm-v1");
      get.onsuccess = () => {
        db.close();
        resolve(get.result);
      };
      get.onerror = () => {
        db.close();
        reject(get.error);
      };
    };
  });
}

it("does not replace a missing key while a pending encrypted record exists", async () => {
  const copy = snapshot();
  await saveOfflineManifest({ shop: copy.shop, manifests: copy.manifests });
  await appendOfflineRollCall("trip-1", {
    bookingId: "ready",
    checkpoint: "departure",
    status: "boarded",
  });
  const before = await rawStoredRecord("trip-1");
  expect(before).toBeDefined();
  await removeKey();
  await expect(loadOfflineManifest("trip-1")).rejects.toThrow();
  expect(await readKey()).toBeUndefined();
  expect(await rawStoredRecord("trip-1")).toEqual(before);
});

it("does not replace an invalid key or pending encrypted record", async () => {
  const copy = snapshot();
  await saveOfflineManifest({ shop: copy.shop, manifests: copy.manifests });
  await appendOfflineRollCall("trip-1", {
    bookingId: "ready",
    checkpoint: "departure",
    status: "boarded",
  });
  const before = await rawStoredRecord("trip-1");
  await replaceKey("invalid-key");
  await expect(loadOfflineManifest("trip-1")).rejects.toThrow();
  expect(await readKey()).toBe("invalid-key");
  expect(await rawStoredRecord("trip-1")).toEqual(before);
});

it("elects one key for simultaneous first writes without Web Locks", async () => {
  expect(navigator.locks).toBeUndefined();
  const first = snapshot();
  const second = snapshot();
  const manifests = second.manifests.map((manifest) => ({
    ...manifest,
    trip: { ...manifest.trip, id: "trip-2" },
  }));
  await Promise.all([
    saveOfflineManifest({ shop: first.shop, manifests: first.manifests }),
    saveOfflineManifest({ shop: second.shop, manifests }),
  ]);
  expect(await loadOfflineManifest("trip-1")).not.toBeNull();
  expect(await loadOfflineManifest("trip-2")).not.toBeNull();
});

it("reads an existing copy even when new key generation is unavailable", async () => {
  const copy = snapshot();
  await saveOfflineManifest({ shop: copy.shop, manifests: copy.manifests });
  const generate = vi
    .spyOn(crypto.subtle, "generateKey")
    .mockRejectedValue(new Error("unavailable"));
  try {
    expect(await loadOfflineManifest("trip-1")).not.toBeNull();
    expect(generate).not.toHaveBeenCalled();
  } finally {
    generate.mockRestore();
  }
});
