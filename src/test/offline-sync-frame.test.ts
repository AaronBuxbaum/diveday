import { expect, it } from "vitest";
import { offlineSnapshotTokenClaims } from "@/lib/offline-manifests";
import { refreshedSyncFrame } from "./offline-sync-frame";
import { snapshot } from "./substrate-fixtures/lib/offline-manifests-fixtures";

it("authors a declared server frame without inventing order between opaque opposing evidence", () => {
  const retained = snapshot();
  retained.erasureEpochToken = `4.8.${"a".repeat(43)}`;
  const frame = refreshedSyncFrame(retained, {
    events: ["boarded", "not_boarded"].map((status, index) => ({
      clientEventId: crypto.randomUUID(),
      snapshotId: retained.snapshotId,
      snapshotSavedAt: retained.savedAt,
      tripId: "trip-1",
      bookingId: "ready",
      checkpoint: "after_dive_1",
      status: status as "boarded" | "not_boarded",
      occurredAt: index === 0 ? "2026-07-20T14:10Z" : "2026-07-20T14:00Z",
      syncStatus: "pending",
    })),
  });
  const received = frame.payloads[0];
  expect(offlineSnapshotTokenClaims(received.erasureEpochToken)).toEqual({ epoch: 4, revision: 9 });
  const row = received.manifests
    .find((item) => item.checkpoint === "after_dive_1")
    ?.divers.find((item) => item.bookingId === "ready");
  expect(
    received.manifests.find((item) => item.checkpoint === "after_dive_1")?.summary,
  ).toMatchObject({ notBackAboard: 1, unaccountedFor: 2 });
  expect(row?.rollCall).toMatchObject({ state: "not_boarded" });
  expect(row?.rollCallContext).toMatchObject({ conflict: true, orderingUnknown: true });
  expect(row?.rollCallContext?.evidence).toHaveLength(2);
  expect(
    row?.rollCallContext?.evidence.every((item) => item.observedEvidenceIds === undefined),
  ).toBe(true);
});
