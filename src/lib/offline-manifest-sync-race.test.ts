// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { rawStoredRecord } from "@/test/offline-raw-record";
import { withRefreshedSyncFrame } from "@/test/offline-sync-frame";
import { snapshot } from "@/test/substrate-fixtures/lib/offline-manifests-fixtures";
import {
  appendOfflineRollCall,
  loadOfflineManifest,
  saveOfflineManifest,
  syncOfflineManifest,
} from "./offline-manifest-store";

afterEach(
  () =>
    new Promise<void>((resolve, reject) => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
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

it.each(["apply", "note_disposition"] as const)(
  "preserves a competing pending event during sync %s",
  async (stage) => {
    const copy = snapshot();
    copy.erasureEpochToken = `0.1.${"a".repeat(43)}`;
    await saveOfflineManifest(copy);
    const first = await appendOfflineRollCall("trip-1", {
      bookingId: "ready",
      checkpoint: "after_dive_1",
      status: "not_boarded",
      note: "first note",
    });
    const base = await rawStoredRecord("trip-1");
    const both = await appendOfflineRollCall("trip-1", {
      bookingId: "ready",
      checkpoint: "after_dive_1",
      status: "boarded",
    });
    const pending = await rawStoredRecord("trip-1");
    await putRecord(base);
    const result = {
      clientEventId: first.events[0].clientEventId,
      status: "applied",
      ...(stage === "note_disposition" ? { noteDisposition: "discarded_erasure_cutoff" } : {}),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify(
              withRefreshedSyncFrame(copy, { results: [result] }, { events: first.events }),
            ),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    let writes = 0;
    const intercepted = vi.spyOn(crypto.subtle, "encrypt").mockImplementation(async (...args) => {
      const bytes = await encrypt(...args);
      if (++writes === (stage === "apply" ? 2 : 1)) await putRecord(pending);
      return bytes;
    });
    await expect(syncOfflineManifest("trip-1")).rejects.toMatchObject({ code: "unavailable" });
    intercepted.mockRestore();
    expect(await rawStoredRecord("trip-1")).toEqual(pending);
    const retained = await loadOfflineManifest("trip-1");
    expect(retained?.events.map((event) => event.clientEventId)).toEqual(
      both.events.map((event) => event.clientEventId),
    );
    if (stage === "note_disposition") {
      // The refusal is an incomplete cleanup, not proof that the server's
      // instruction was applied to the concurrently replaced ciphertext.
      expect(retained?.events[0].note).toBe("first note");
      expect(retained?.events[0].noteDisposition).toBeUndefined();
      expect(retained?.events[0].syncStatus).toBe("pending");
    }
  },
);
