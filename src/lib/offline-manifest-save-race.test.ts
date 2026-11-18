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

async function writeRecord(record: unknown | null) {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("manifests", "readwrite");
      const store = tx.objectStore("manifests");
      if (record === null) store.delete("trip-1");
      else store.put(record);
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

it.each([
  { foreign: true, occupied: true },
  { foreign: false, occupied: true },
  { foreign: true, occupied: false },
  { foreign: false, occupied: false },
])(
  "does not overwrite a pending tap after the refresh read (foreign=$foreign, occupied=$occupied)",
  async ({ foreign: isForeign, occupied }) => {
    const copy = snapshot();
    await saveOfflineManifest({
      shop: isForeign ? { ...copy.shop, slug: "foreign-shop" } : copy.shop,
      manifests: copy.manifests,
    });
    const queued = await appendOfflineRollCall("trip-1", {
      bookingId: "ready",
      checkpoint: "departure",
      status: "boarded",
    });
    const pending = await rawStoredRecord("trip-1");
    expect(pending).toBeDefined();
    // Build the competing same-trip snapshot in this disposable test database.
    await writeRecord(null);
    const payload = { shop: copy.shop, manifests: copy.manifests };
    if (occupied) await saveOfflineManifest(payload);
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    const intercepted = vi
      .spyOn(crypto.subtle, "encrypt")
      .mockImplementationOnce(async (...args) => {
        const ciphertext = await encrypt(...args);
        // Another context commits after the save's read but before its write.
        await writeRecord(pending);
        return ciphertext;
      });
    await expect(saveOfflineManifest(payload)).rejects.toThrow();
    intercepted.mockRestore();
    expect(await rawStoredRecord("trip-1")).toEqual(pending);
    expect((await loadOfflineManifest("trip-1"))?.events[0]?.clientEventId).toBe(
      queued.events[0]?.clientEventId,
    );
  },
);

it("does not return a stale copy when a matching-token refresh races a replacement", async () => {
  const copy = snapshot();
  const foreignPayload = {
    shop: { ...copy.shop, slug: "foreign-shop" },
    manifests: copy.manifests,
  };
  await saveOfflineManifest(foreignPayload);
  const queued = await appendOfflineRollCall("trip-1", {
    bookingId: "ready",
    checkpoint: "departure",
    status: "boarded",
  });
  const pending = await rawStoredRecord("trip-1");
  await writeRecord(null);
  const payload = {
    shop: copy.shop,
    manifests: copy.manifests,
    erasureEpochToken: `1.1.${"a".repeat(43)}`,
  };
  await saveOfflineManifest(payload);
  const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
  const intercepted = vi.spyOn(crypto.subtle, "decrypt").mockImplementationOnce(async (...args) => {
    const plaintext = await decrypt(...args);
    await writeRecord(pending);
    return plaintext;
  });
  await expect(saveOfflineManifest(payload)).rejects.toThrow();
  intercepted.mockRestore();
  expect(await rawStoredRecord("trip-1")).toEqual(pending);
  expect((await loadOfflineManifest("trip-1"))?.events[0]?.clientEventId).toBe(
    queued.events[0]?.clientEventId,
  );
});
