import { describe, expect, it } from "vitest";
import type { OfflineRollCallEvent } from "@/lib/offline-manifests";
import { offlineTripView } from "./trip-view";
import { richEnvelope } from "./view-fixtures";

/**
 * **The after-dive readiness word on the offline copy** (issue #2286). The
 * live roll call keeps a blocked person's readiness on their row after a dive
 * when nobody boarded them earlier — a `boarded` there would be their first —
 * and the copy a captain reads with no signal must say the same. It reads
 * this device's own taps too, not only what the copy was saved with.
 */
describe("offlineTripView — blocked at the rail after a dive", () => {
  const boardedAtDock: OfflineRollCallEvent = {
    clientEventId: "event-1",
    snapshotId: "snap-trip-1",
    snapshotSavedAt: "2026-08-01T12:00:00.000Z",
    tripId: "trip-1",
    bookingId: "diver-priya",
    checkpoint: "departure",
    status: "boarded",
    occurredAt: "2026-08-01T12:58:00.000Z",
    syncStatus: "pending",
  };

  it("marks a blocked diver nobody boarded at the dock", () => {
    const view = offlineTripView(richEnvelope("trip-1", { readiness: "blocked" }), "after_dive_1");
    expect(view?.blockedAtRail).toEqual([true]);
  });

  it("does not mark the same diver once this device boarded them at the dock", () => {
    const view = offlineTripView(
      richEnvelope("trip-1", { readiness: "blocked" }, { events: [boardedAtDock] }),
      "after_dive_1",
    );
    expect(view?.blockedAtRail).toEqual([false]);
  });

  it("does not mark a ready diver, and marks a blocked one at the dock", () => {
    expect(offlineTripView(richEnvelope("trip-1"), "after_dive_1")?.blockedAtRail).toEqual([false]);
    expect(
      offlineTripView(richEnvelope("trip-1", { readiness: "blocked" }), "departure")?.blockedAtRail,
    ).toEqual([true]);
  });
});
