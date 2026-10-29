// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadOfflineManifest,
  purgeOfflineManifestsExceptShop,
  saveOfflineManifest,
} from "./offline-manifest-store";
import type { OfflineManifestPayload } from "./offline-manifests";

const tripId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const reefRunners: OfflineManifestPayload = {
  shop: {
    slug: "reef-runners",
    name: "Reef Runners",
    timezone: "America/New_York",
    emergencyReference: { lines: [], vessel: "", shoreContact: "", plan: "" },
  },
  manifests: [
    {
      trip: {
        id: tripId,
        title: "Morning Two-Tank",
        startsAt: "2026-08-02T13:00:00.000Z",
        endsAt: "2026-08-02T16:30:00.000Z",
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

afterEach(
  () =>
    new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("diveday-offline-manifests");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("failed to reset IndexedDB"));
    }),
);

describe("overlapping verified-tenant purge rounds", () => {
  it("keeps a newer shop's IndexedDB snapshot when its round supersedes the locked reread", async () => {
    await saveOfflineManifest(reefRunners);

    let latestRound = 1;
    let currentChecks = 0;
    let newerPurge: Promise<string[]> | null = null;
    const olderPurge = purgeOfflineManifestsExceptShop("blue-mantis", {
      // The verification is current through the lock acquisition. Start the
      // newer tenant round after the locked reread but while the delete
      // helper is opening IndexedDB; its final guard must stop the write.
      isCurrent: () => {
        currentChecks += 1;
        if (currentChecks === 4) {
          queueMicrotask(() => {
            latestRound = 2;
            newerPurge = purgeOfflineManifestsExceptShop("reef-runners", {
              isCurrent: () => latestRound === 2,
            });
          });
        }
        return latestRound === 1;
      },
    });
    const deleted = await olderPurge;

    expect(currentChecks).toBe(5);
    expect(deleted).toEqual([]);
    expect(newerPurge).not.toBeNull();
    if (!newerPurge) throw new Error("newly verified purge was not started");
    expect(await newerPurge).toEqual([]);
    expect((await loadOfflineManifest(tripId))?.snapshot.shop.slug).toBe("reef-runners");
  });
});
