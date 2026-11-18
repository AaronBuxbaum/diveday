// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { rawStoredRecord } from "@/test/offline-raw-record";
import { snapshot } from "@/test/substrate-fixtures/lib/offline-manifests-fixtures";
import {
  appendOfflineRollCall,
  loadOfflineManifest,
  saveOfflineManifest,
  saveOfflineMedicalAlerts,
  wipeOfflineMedicalAlerts,
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

it.each(["save", "wipe"] as const)(
  "does not erase a competing pending tap during medical %s",
  async (operation) => {
    const copy = snapshot();
    for (const manifest of copy.manifests) manifest.divers[0].medicalAlert = {};
    await saveOfflineManifest({ shop: copy.shop, manifests: copy.manifests });
    const author = { personId: "crew-1", name: "Crew", savedAt: "2026-07-21T13:30:00.000Z" };
    await saveOfflineMedicalAlerts("trip-1", { ready: "sensitive" }, author);
    const before = await rawStoredRecord("trip-1");
    const queued = await appendOfflineRollCall("trip-1", {
      bookingId: "ready",
      checkpoint: "departure",
      status: "boarded",
    });
    const pending = await rawStoredRecord("trip-1");
    await putRecord(before);
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    const intercepted = vi
      .spyOn(crypto.subtle, "encrypt")
      .mockImplementationOnce(async (...args) => {
        const bytes = await encrypt(...args);
        await putRecord(pending);
        return bytes;
      });
    const write =
      operation === "save"
        ? saveOfflineMedicalAlerts("trip-1", { ready: "updated" }, author)
        : wipeOfflineMedicalAlerts();
    await expect(write).rejects.toMatchObject({ code: "unavailable" });
    intercepted.mockRestore();
    expect(await rawStoredRecord("trip-1")).toEqual(pending);
    expect((await loadOfflineManifest("trip-1"))?.events[0]?.clientEventId).toBe(
      queued.events[0]?.clientEventId,
    );
  },
);
