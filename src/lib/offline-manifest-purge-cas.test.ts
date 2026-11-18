// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { rawStoredRecord } from "@/test/offline-raw-record";
import { snapshot } from "@/test/substrate-fixtures/lib/offline-manifests-fixtures";
import {
  appendOfflineRollCall,
  beginOfflineTenantVerificationRound,
  loadOfflineManifest,
  purgeOfflineManifestsExceptShop,
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

it.each([0, 1])(
  "does not purge a newer encrypted tap with pending metadata %s",
  async (pendingEvents) => {
    const copy = snapshot();
    await saveOfflineManifest({ shop: copy.shop, manifests: copy.manifests });
    const empty = await rawStoredRecord("trip-1");
    await appendOfflineRollCall("trip-1", {
      bookingId: "ready",
      checkpoint: "departure",
      status: "boarded",
    });
    const pending = (await rawStoredRecord("trip-1")) as Record<string, unknown>;
    const replacement = { ...pending, pendingEvents };
    await putRecord(empty);
    const round = await beginOfflineTenantVerificationRound();
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    let reads = 0;
    const intercepted = vi.spyOn(crypto.subtle, "decrypt").mockImplementation(async (...args) => {
      const plaintext = await decrypt(...args);
      if (++reads === 2) await putRecord(replacement);
      return plaintext;
    });
    await expect(purgeOfflineManifestsExceptShop("other-shop", round)).rejects.toMatchObject({
      code: "unavailable",
    });
    intercepted.mockRestore();
    expect(await rawStoredRecord("trip-1")).toEqual(replacement);
    expect((await loadOfflineManifest("trip-1"))?.events[0]?.syncStatus).toBe("pending");
  },
);

it("does not purge an empty foreign record with unknown metadata", async () => {
  const copy = snapshot();
  await saveOfflineManifest({ shop: copy.shop, manifests: copy.manifests });
  const saved = (await rawStoredRecord("trip-1")) as Record<string, unknown>;
  const unknown = { ...saved, futureMetadata: "unknown" };
  await putRecord(unknown);
  const round = await beginOfflineTenantVerificationRound();
  await expect(purgeOfflineManifestsExceptShop("other-shop", round)).rejects.toMatchObject({
    code: "unavailable",
  });
  expect(await rawStoredRecord("trip-1")).toEqual(unknown);
});

it("refuses a record whose plaintext tenant metadata disagrees with the encrypted copy", async () => {
  const copy = snapshot();
  await saveOfflineManifest({ shop: copy.shop, manifests: copy.manifests });
  const saved = (await rawStoredRecord("trip-1")) as Record<string, unknown>;
  const mismatched = { ...saved, shopSlug: "third-shop" };
  await putRecord(mismatched);
  const round = await beginOfflineTenantVerificationRound();
  await expect(purgeOfflineManifestsExceptShop("other-shop", round)).rejects.toMatchObject({
    code: "unavailable",
  });
  expect(await rawStoredRecord("trip-1")).toEqual(mismatched);
});

it("refuses to refresh a foreign occupied trip slot and preserves its pending event", async () => {
  const copy = snapshot();
  await saveOfflineManifest({ shop: copy.shop, manifests: copy.manifests });
  await appendOfflineRollCall("trip-1", {
    bookingId: "ready",
    checkpoint: "departure",
    status: "boarded",
  });
  const before = await rawStoredRecord("trip-1");
  await expect(
    saveOfflineManifest({ shop: { ...copy.shop, slug: "other-shop" }, manifests: copy.manifests }),
  ).rejects.toMatchObject({ code: "shop_changed" });
  expect(await rawStoredRecord("trip-1")).toEqual(before);
  expect((await loadOfflineManifest("trip-1"))?.events[0]?.syncStatus).toBe("pending");
});
