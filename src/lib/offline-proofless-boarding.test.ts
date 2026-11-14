import { expect, it } from "vitest";
import { snapshot } from "../test/substrate-fixtures/lib/offline-manifests-fixtures";
import { verifiedFixture } from "../test/verified-offline-meeting";
import { latestOfflineRollCall } from "./offline-manifests";

it("retains a proofless pending boarding for review without confirming it", () => {
  const saved = snapshot();
  const events = [
    {
      clientEventId: "proofless-event",
      snapshotId: saved.snapshotId,
      snapshotSavedAt: saved.savedAt,
      tripId: "trip-1",
      bookingId: "ready",
      checkpoint: "departure" as const,
      status: "boarded" as const,
      occurredAt: "2026-07-20T11:05:00.000Z",
      syncStatus: "pending" as const,
    },
  ];
  expect(latestOfflineRollCall(saved, events, "ready", "departure")).toBeUndefined();
  expect(events[0].syncStatus).toBe("pending");
});

it("exposes a verified pending device statement and its exact undo identity", () => {
  const { saved, tripId, meetingIdentityProof } = verifiedFixture(snapshot());
  const latest = latestOfflineRollCall(
    saved,
    [
      {
        clientEventId: "event-1",
        snapshotId: saved.snapshotId,
        snapshotSavedAt: saved.savedAt,
        tripId,
        meetingDay: 0,
        meetingIdentityProof,
        bookingId: "ready",
        checkpoint: "departure",
        status: "boarded",
        occurredAt: "2026-07-20T11:05:00.000Z",
        syncStatus: "pending",
      },
    ],
    "ready",
    "departure",
  );
  expect(latest).toMatchObject({
    state: "boarded",
    occurredAt: "2026-07-20T11:05:00.000Z",
    pending: true,
    implied: false,
    local: true,
    clientEventId: "event-1",
  });
});
