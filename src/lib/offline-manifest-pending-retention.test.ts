// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
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

it("retains past-grace pending evidence while withholding it from normal use and refresh", async () => {
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
        record.expiresAt = "2000-01-01T00:00:00.000Z";
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
    };
  });
  const before = await rawStoredRecord("trip-1");
  expect(before).toBeDefined();
  await expect(loadOfflineManifest("trip-1")).rejects.toMatchObject({ code: "recovery_required" });
  expect(await rawStoredRecord("trip-1")).toEqual(before);
  await expect(saveOfflineManifest(payload)).rejects.toMatchObject({ code: "recovery_required" });
  expect(await rawStoredRecord("trip-1")).toEqual(before);
});
