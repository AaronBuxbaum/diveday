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
      vi.restoreAllMocks();
      const request = indexedDB.deleteDatabase("diveday-offline-manifests");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }),
);

async function putRecord(record: unknown) {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("manifests", "readwrite");
      tx.objectStore("manifests").put(record);
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

it("does not delete a newer pending tap after reading an expired empty copy", async () => {
  const copy = snapshot();
  await saveOfflineManifest({ shop: copy.shop, manifests: copy.manifests });
  const empty = (await rawStoredRecord("trip-1")) as Record<string, unknown>;
  await appendOfflineRollCall("trip-1", {
    bookingId: "ready",
    checkpoint: "departure",
    status: "boarded",
  });
  const pending = await rawStoredRecord("trip-1");
  expect(pending).toBeDefined();
  await putRecord({ ...empty, expiresAt: "2000-01-01T00:00:00.000Z" });
  const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
  const intercepted = vi.spyOn(crypto.subtle, "decrypt").mockImplementationOnce(async (...args) => {
    const plaintext = await decrypt(...args);
    // Another context commits the newer record after this read, before delete.
    await putRecord(pending);
    return plaintext;
  });
  await expect(loadOfflineManifest("trip-1")).rejects.toMatchObject({ code: "unavailable" });
  intercepted.mockRestore();
  expect(await rawStoredRecord("trip-1")).toEqual(pending);
  expect((await loadOfflineManifest("trip-1"))?.events[0]?.syncStatus).toBe("pending");
});

it("does not delete an expired record with unrecognized metadata", async () => {
  const copy = snapshot();
  await saveOfflineManifest({ shop: copy.shop, manifests: copy.manifests });
  const stored = (await rawStoredRecord("trip-1")) as Record<string, unknown>;
  const unknown = { ...stored, expiresAt: "2000-01-01T00:00:00.000Z", futureMetadata: "unknown" };
  await putRecord(unknown);
  await expect(loadOfflineManifest("trip-1")).rejects.toMatchObject({ code: "unavailable" });
  expect(await rawStoredRecord("trip-1")).toEqual(unknown);
});
