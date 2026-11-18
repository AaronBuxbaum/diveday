// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { TEST_FROZEN_CLOCK } from "@/test/frozen-clock";
import { rawStoredRecord } from "@/test/offline-raw-record";
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

async function recordLoss(
  record: OfflineManifestPayload = payload,
  pendingEvents = 1,
): Promise<void> {
  const id = record.manifests[0].trip.id;
  // These notices represent losses recorded by an older release. Seed the
  // historical metadata rather than destroy a current pending event to make one.
  await saveOfflineManifest(record);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("keys", "readwrite");
      const store = tx.objectStore("keys");
      const get = store.get("discarded-pending-roll-call-v1");
      get.onsuccess = () =>
        store.put(
          [
            ...(get.result ?? []),
            {
              noticeId: crypto.randomUUID(),
              tripId: id,
              tripTitle: record.manifests[0].trip.title,
              shopName: record.shop.name,
              shopSlug: record.shop.slug,
              pendingEvents,
              discardedAt: TEST_FROZEN_CLOCK,
            },
          ],
          "discarded-pending-roll-call-v1",
        );
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
  it("reads and acknowledges a historical combined-event count", async () => {
    await recordLoss(payload, 2);
    const notices = await readDiscardedOfflineRecords();
    expect(notices).toMatchObject([{ pendingEvents: 2 }]);
    await acknowledgeDiscardedOfflineRecords(notices);
    expect(await readDiscardedOfflineRecords()).toEqual([]);
  });
  it("acknowledges historical minimal metadata without changing current pending evidence", async () => {
    await recordLoss();
    await appendOfflineRollCall(tripId, {
      bookingId,
      checkpoint: "departure",
      status: "not_boarded",
    });
    const before = await rawStoredRecord(tripId);
    const notices = await readDiscardedOfflineRecords();
    expect(notices).toHaveLength(1);
    const encoded = JSON.stringify(notices);
    for (const secret of [bookingId, "Nora Quinn", "Sam Quinn", "+1-305-555-0100"]) {
      expect(encoded).not.toContain(secret);
    }
    await acknowledgeDiscardedOfflineRecords(notices);
    expect(await readDiscardedOfflineRecords()).toEqual([]);
    expect(await rawStoredRecord(tripId)).toEqual(before);
    expect((await loadOfflineManifest(tripId))?.events[0]?.syncStatus).toBe("pending");
  });
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

  it("retains pending arrival and checklist evidence without a false discard notice", async () => {
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

    const before = await rawStoredRecord(tripId);
    await expect(loadOfflineManifest(tripId)).rejects.toMatchObject({ code: "recovery_required" });
    expect(await rawStoredRecord(tripId)).toEqual(before);
    expect(await readDiscardedOfflineRecords()).toEqual([]);
  });
});
