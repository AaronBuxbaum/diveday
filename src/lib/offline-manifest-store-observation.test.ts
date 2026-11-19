// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { snapshot } from "@/test/substrate-fixtures/lib/offline-manifests-fixtures";
import {
  appendOfflineRollCall,
  loadOfflineManifest,
  saveOfflineManifest,
} from "./offline-manifest-store";

afterEach(
  () =>
    new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("diveday-offline-manifests");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }),
);

it("queues a deliberately delayed individual observation with its exact captured evidence and explicit intent", async () => {
  const copy = snapshot();
  await saveOfflineManifest({ shop: copy.shop, manifests: copy.manifests });
  const occurredAt = new Date(nowDate().getTime() - 60_000).toISOString();
  const queued = await appendOfflineRollCall("trip-1", {
    bookingId: "blocked",
    checkpoint: "departure",
    status: "boarded",
    physicalPresenceOnly: true,
    occurredAt,
    observedEvidenceIds: [],
    meetingDay: 0,
  });
  expect(queued.events).toHaveLength(1);
  expect(queued.events[0]).toMatchObject({
    bookingId: "blocked",
    occurredAt,
    physicalPresenceOnly: true,
    observedEvidenceIds: [],
    meetingDay: 0,
    syncStatus: "pending",
  });
  expect(
    (await loadOfflineManifest("trip-1"))?.snapshot.manifests[0].divers.find(
      (person) => person.bookingId === "blocked",
    )?.readiness.status,
  ).toBe("blocked");
});

it("retains ordinary offline readiness refusal", async () => {
  const copy = snapshot();
  await saveOfflineManifest({ shop: copy.shop, manifests: copy.manifests });
  await expect(
    appendOfflineRollCall("trip-1", {
      bookingId: "blocked",
      checkpoint: "departure",
      status: "boarded",
    }),
  ).rejects.toMatchObject({ code: "not_allowed" });
  expect((await loadOfflineManifest("trip-1"))?.events).toEqual([]);
});

it("durably keeps the snapshot witness with the original queued observation", async () => {
  const copy = snapshot();
  await saveOfflineManifest({
    shop: copy.shop,
    manifests: copy.manifests,
    rollCallWitnesses: { "seat:ready:departure": "signed-witness" },
  });
  const queued = await appendOfflineRollCall("trip-1", {
    bookingId: "ready",
    checkpoint: "departure",
    status: "boarded",
    meetingDay: 0,
  });
  expect(queued.events[0]).toMatchObject({
    rollCallWitness: "signed-witness",
    syncStatus: "pending",
  });
  expect((await loadOfflineManifest("trip-1"))?.events[0]).toMatchObject({
    clientEventId: queued.events[0]?.clientEventId,
    rollCallWitness: "signed-witness",
  });
});

it("refuses malformed or future selected observation instants without storing evidence", async () => {
  const copy = snapshot();
  await saveOfflineManifest({ shop: copy.shop, manifests: copy.manifests });
  for (const occurredAt of [
    "not-an-instant",
    "2026-02-30T12:00:00.000Z",
    new Date(nowDate().getTime() + 60_000).toISOString(),
  ]) {
    await expect(
      appendOfflineRollCall("trip-1", {
        bookingId: "ready",
        checkpoint: "departure",
        status: "boarded",
        occurredAt,
      }),
    ).rejects.toMatchObject({ code: "not_allowed" });
  }
  expect((await loadOfflineManifest("trip-1"))?.events).toEqual([]);
});

it("refuses a selected meeting day outside the saved schedule", async () => {
  const copy = snapshot();
  await saveOfflineManifest({ shop: copy.shop, manifests: copy.manifests });
  for (const meetingDay of [-1, 0.5, 2]) {
    await expect(
      appendOfflineRollCall("trip-1", {
        bookingId: "ready",
        checkpoint: "departure",
        status: "boarded",
        meetingDay,
      }),
    ).rejects.toMatchObject({ code: "not_allowed" });
  }
  expect((await loadOfflineManifest("trip-1"))?.events).toEqual([]);
});

it("keeps released and turned-away seats on their existing separate observation path", async () => {
  for (const release of [{ notHere: true }, { notHere: true, turnedAway: true as const }]) {
    const copy = snapshot();
    Object.assign(copy.manifests[0].divers[1], release);
    await saveOfflineManifest({ shop: copy.shop, manifests: copy.manifests });
    await expect(
      appendOfflineRollCall("trip-1", {
        bookingId: "blocked",
        checkpoint: "departure",
        status: "boarded",
        physicalPresenceOnly: true,
      }),
    ).rejects.toMatchObject({ code: "not_allowed" });
    expect((await loadOfflineManifest("trip-1"))?.events).toEqual([]);
  }
});
