// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendOfflineChecklistCheck,
  beginOfflineTenantVerificationRound,
  loadOfflineManifest,
  type OfflineManifestError,
  purgeOfflineManifestsExceptShop,
  saveOfflineManifest,
  syncOfflineManifest,
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
  checklist: { items: [{ id: "briefing-check", label: "Briefing" }] },
};

afterEach(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("diveday-offline-manifests");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("failed to reset IndexedDB"));
  });
});

describe("overlapping verified-tenant purge rounds", () => {
  it("keeps a newer shop's IndexedDB snapshot when its round supersedes the locked reread", async () => {
    await saveOfflineManifest(reefRunners);

    const olderRound = await beginOfflineTenantVerificationRound();
    let latestRound = 1;
    let currentChecks = 0;
    let newerPurge: Promise<string[]> | null = null;
    let signalNewerStarted!: () => void;
    const newerStarted = new Promise<void>((resolve) => {
      signalNewerStarted = resolve;
    });
    const olderPurge = purgeOfflineManifestsExceptShop("blue-mantis", olderRound, {
      // The verification is current through the lock acquisition. Start the
      // newer tenant round after the locked reread but while the delete
      // helper is opening IndexedDB; its final guard must stop the write.
      isCurrent: () => {
        currentChecks += 1;
        if (currentChecks === 4) {
          queueMicrotask(() => {
            latestRound = 2;
            void beginOfflineTenantVerificationRound().then((newerRound) => {
              newerPurge = purgeOfflineManifestsExceptShop("reef-runners", newerRound, {
                isCurrent: () => latestRound === 2,
              });
              signalNewerStarted();
            });
          });
        }
        return latestRound === 1;
      },
    });
    const deleted = await olderPurge;
    await newerStarted;

    expect(currentChecks).toBe(6);
    expect(deleted).toEqual([]);
    expect(newerPurge).not.toBeNull();
    if (!newerPurge) throw new Error("newly verified purge was not started");
    expect(await newerPurge).toEqual([]);
    expect((await loadOfflineManifest(tripId))?.snapshot.shop.slug).toBe("reef-runners");
  });

  it("does not let a delayed worker/autosave tenant response purge a later verified shop snapshot", async () => {
    // These represent separate browser/worker callers: their only shared state
    // is IndexedDB. Shop B starts a refresh first, then the device switches
    // back to A and its newer refresh saves an A snapshot before B's response
    // reaches the purge step.
    const delayedShopBRound = await beginOfflineTenantVerificationRound();
    const currentShopARound = await beginOfflineTenantVerificationRound();
    expect(currentShopARound).toBeGreaterThan(delayedShopBRound);

    const blueMantis: OfflineManifestPayload = {
      ...reefRunners,
      shop: { ...reefRunners.shop, slug: "blue-mantis", name: "Blue Mantis" },
    };
    await saveOfflineManifest(blueMantis, { tenantRound: currentShopARound });

    expect(await purgeOfflineManifestsExceptShop("reef-runners", delayedShopBRound)).toEqual([]);
    expect((await loadOfflineManifest(tripId))?.snapshot.shop.slug).toBe("blue-mantis");
    expect(await purgeOfflineManifestsExceptShop("blue-mantis", currentShopARound)).toEqual([]);
    expect((await loadOfflineManifest(tripId))?.snapshot.shop.slug).toBe("blue-mantis");
  });

  it("rejects a delayed snapshot response after a newer tenant verification began", async () => {
    const delayedShopBRound = await beginOfflineTenantVerificationRound();
    const currentShopARound = await beginOfflineTenantVerificationRound();
    const blueMantis: OfflineManifestPayload = {
      ...reefRunners,
      shop: { ...reefRunners.shop, slug: "blue-mantis", name: "Blue Mantis" },
    };

    await expect(
      saveOfflineManifest(blueMantis, { tenantRound: delayedShopBRound }),
    ).rejects.toMatchObject({ code: "shop_changed" });
    expect(await loadOfflineManifest(tripId)).toBeNull();

    await saveOfflineManifest(reefRunners, { tenantRound: currentShopARound });
    expect((await loadOfflineManifest(tripId))?.snapshot.shop.slug).toBe("reef-runners");
  });

  it("does not settle an offline note when its sync response loses the shared tenant round", async () => {
    await saveOfflineManifest(reefRunners);
    const queued = await appendOfflineChecklistCheck(tripId, {
      checklistItemId: "briefing-check",
      status: "checked",
      note: "keep this pending",
    });
    let releaseResponse!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    let signalRequest!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      signalRequest = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        signalRequest();
        await responseGate;
        return new Response(
          JSON.stringify({
            results: [
              {
                clientEventId: queued.checklistEvents[0].clientEventId,
                status: "applied",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const delayedSync = syncOfflineManifest(tripId, "reef-runners");
    await requestStarted;
    await beginOfflineTenantVerificationRound();
    releaseResponse();

    await expect(delayedSync).rejects.toMatchObject({
      code: "shop_changed",
    } satisfies Partial<OfflineManifestError>);
    expect((await loadOfflineManifest(tripId))?.checklistEvents[0]).toMatchObject({
      syncStatus: "pending",
      note: "keep this pending",
    });
  });
});
