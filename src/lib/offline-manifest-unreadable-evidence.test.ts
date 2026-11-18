// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { rawStoredRecord } from "@/test/offline-raw-record";
import { snapshot } from "@/test/substrate-fixtures/lib/offline-manifests-fixtures";
import {
  appendOfflineRollCall,
  listOfflineManifests,
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

it("reports an incomplete inventory rather than hiding an unreadable copy", async () => {
  const copy = snapshot();
  const manifests = copy.manifests.map((manifest) => ({
    ...manifest,
    trip: { ...manifest.trip, id: "trip-2" },
  }));
  await saveOfflineManifest({ shop: copy.shop, manifests });
  await makeUnreadable(false);
  const before = await rawStoredRecord("trip-1");
  await expect(listOfflineManifests()).rejects.toThrow();
  expect(await rawStoredRecord("trip-1")).toEqual(before);
  expect(await loadOfflineManifest("trip-2")).not.toBeNull();
});

async function makeUnreadable(expired: boolean) {
  const copy = snapshot();
  const payload = { shop: copy.shop, manifests: copy.manifests };
  await saveOfflineManifest(payload);
  const queued = await appendOfflineRollCall("trip-1", {
    bookingId: "ready",
    checkpoint: "departure",
    status: "boarded",
  });
  expect(queued.events[0]?.syncStatus).toBe("pending");
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("manifests", "readwrite");
      const store = tx.objectStore("manifests");
      const get = store.get("trip-1");
      get.onsuccess = () => {
        const record = get.result;
        const iv = new Uint8Array(record.iv);
        iv[0] ^= 1;
        record.iv = iv.buffer;
        if (expired) record.expiresAt = "2000-01-01T00:00:00.000Z";
        store.put(record);
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
  return payload;
}

it.each([false, true])(
  "retains unreadable queued evidence on load (expired=%s)",
  async (expired) => {
    await makeUnreadable(expired);
    const before = await rawStoredRecord("trip-1");
    expect(before).toBeDefined();
    await expect(loadOfflineManifest("trip-1")).rejects.toThrow();
    expect(await rawStoredRecord("trip-1")).toEqual(before);
  },
);

it.each([false, true])(
  "does not overwrite unreadable queued evidence on refresh (expired=%s)",
  async (expired) => {
    const payload = await makeUnreadable(expired);
    const before = await rawStoredRecord("trip-1");
    expect(before).toBeDefined();
    await expect(saveOfflineManifest(payload)).rejects.toThrow();
    expect(await rawStoredRecord("trip-1")).toEqual(before);
  },
);
