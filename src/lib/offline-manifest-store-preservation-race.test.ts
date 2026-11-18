// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { rawStoredRecord } from "@/test/offline-raw-record";
import {
  beginOfflineTenantVerificationRound,
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
