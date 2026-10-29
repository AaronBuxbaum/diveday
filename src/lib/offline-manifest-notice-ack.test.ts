// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { TEST_FROZEN_CLOCK } from "@/test/frozen-clock";
import {
  acknowledgeDiscardedOfflineRecords,
  appendOfflineArrival,
  appendOfflineChecklistCheck,
  appendOfflineRollCall,
  loadOfflineManifest,
  OFFLINE_MANIFEST_PENDING_GRACE_MS,
  readDiscardedOfflineRecords,
  saveOfflineManifest,
} from "./offline-manifest-store";
import type { OfflineManifestPayload } from "./offline-manifests";

const tripId = "11111111-1111-1111-1111-111111111111";
const bookingId = "22222222-2222-2222-2222-222222222222";
const expiredPastGrace = new Date(
  Date.parse(TEST_FROZEN_CLOCK) - OFFLINE_MANIFEST_PENDING_GRACE_MS - 24 * 60 * 60 * 1000,
).toISOString();
const payload: OfflineManifestPayload = {
  shop: {
    slug: "blue-mantis",
    name: "Blue Mantis Divers",
    timezone: "America/New_York",
  },
  manifests: [
    {
      trip: {
        id: tripId,
        title: "Two-Tank Reef",
        startsAt: "2026-08-01T13:00:00.000Z",
        endsAt: "2026-08-01T16:30:00.000Z",
        plannedDives: 2,
      },
      checkpoint: "departure",
      crew: [],
      divers: [
        {
          bookingId,
          fullName: "Nora Quinn",
          email: null,
          emergencyContactName: "Sam Quinn",
          emergencyContactPhone: "+1-305-555-0100",
          readiness: { status: "ready", blockers: [] },
          rentalFit: { state: "not_recorded" },
          nitroxRequested: false,
          rollCall: undefined,
        },
      ],
      summary: {
        totalDivers: 1,
        ready: 1,
        blocked: 0,
        boarded: 0,
        notBoarded: 0,
        notBackAboard: 0,
        awaiting: 1,
        unaccountedFor: 1,
        overCapacity: 0,
        notHere: 0,
      },
    },
  ],
};

async function recordLoss(record: OfflineManifestPayload = payload): Promise<void> {
  const id = record.manifests[0].trip.id;
  await saveOfflineManifest(record);
  await appendOfflineRollCall(id, { bookingId, checkpoint: "departure", status: "not_boarded" });
  await backdateExpiry(id);
  await loadOfflineManifest(id);
}

function backdateExpiry(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 1);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction("manifests", "readonly").objectStore("manifests").get(id);
      get.onsuccess = () => {
        const row = get.result;
        row.expiresAt = expiredPastGrace;
        const write = db.transaction("manifests", "readwrite").objectStore("manifests").put(row);
        write.onsuccess = () => {
          db.close();
          resolve();
        };
        write.onerror = () => reject(write.error);
      };
      get.onerror = () => reject(get.error);
    };
    request.onerror = () => reject(request.error);
  });
}

afterEach(
  () =>
    new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("diveday-offline-manifests");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("failed to reset IndexedDB"));
    }),
);

describe("acknowledgeDiscardedOfflineRecords", () => {
  it("keeps another shop's notice unseen when the visible shop is acknowledged", async () => {
    await recordLoss();
    await recordLoss({
      ...payload,
      shop: { ...payload.shop, slug: "reef-runners", name: "Reef Runners" },
      manifests: [
        {
          ...payload.manifests[0],
          trip: { ...payload.manifests[0].trip, id: "33333333-3333-3333-3333-333333333333" },
        },
      ],
    });
    const [own, unseen] = await readDiscardedOfflineRecords();

    await acknowledgeDiscardedOfflineRecords([own]);

    expect(await readDiscardedOfflineRecords()).toEqual([unseen]);
  });

  it("keeps a newer notice for the same shop and trip after acknowledging the earlier one", async () => {
    await recordLoss();
    const [earlier] = await readDiscardedOfflineRecords();
    expect(earlier.noticeId).toEqual(expect.any(String));
    await recordLoss();
    const [, newer] = await readDiscardedOfflineRecords();

    await acknowledgeDiscardedOfflineRecords([earlier]);

    expect(await readDiscardedOfflineRecords()).toEqual([newer]);
  });

  it("counts arrival and checklist evidence without describing it as roll call", async () => {
    const withChecklist = {
      ...payload,
      checklist: { items: [{ id: "oxygen", label: "Oxygen kit" }] },
    } satisfies OfflineManifestPayload;
    await saveOfflineManifest(withChecklist);
    await appendOfflineArrival(tripId, { bookingId, status: "arrived" });
    await appendOfflineChecklistCheck(tripId, {
      checklistItemId: "oxygen",
      status: "checked",
      note: null,
    });
    await backdateExpiry(tripId);

    expect(await loadOfflineManifest(tripId)).toBeNull();
    expect(await readDiscardedOfflineRecords()).toMatchObject([{ pendingEvents: 2 }]);
  });
});
