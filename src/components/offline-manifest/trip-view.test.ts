import { describe, expect, it } from "vitest";
import type { OfflineRollCallEvent } from "@/lib/offline-manifests";
import { savedCopy, view } from "./section-fixtures";
import { offlineTripView } from "./trip-view";
import { richEnvelope } from "./view-fixtures";

describe("offlineTripView", () => {
  it("counts nobody called as awaiting, and the checkpoint as open", () => {
    const trip = view();
    expect(trip.totalDivers).toBe(2);
    expect(trip.awaiting).toBe(2);
    expect(trip.boarded).toBe(0);
    expect(trip.rollCallComplete).toBe(false);
    expect(trip.missingDivers.map((entry) => entry.bookingId)).toEqual(["b-priya", "b-marcus"]);
  });

  it("is null for a copy that carries no manifest", () => {
    const copy = savedCopy();
    expect(
      offlineTripView({ ...copy, snapshot: { ...copy.snapshot, manifests: [] } }, "departure"),
    ).toBeNull();
  });
});

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

  it("reads earlier by checkpoint order, not by where the copy lists it", () => {
    const envelope = richEnvelope("trip-1", { readiness: "blocked" }, { events: [boardedAtDock] });
    const reversed = {
      ...envelope,
      snapshot: { ...envelope.snapshot, manifests: [...envelope.snapshot.manifests].reverse() },
    };
    expect(offlineTripView(reversed, "after_dive_1")?.blockedAtRail).toEqual([false]);
  });

  it("does not mark a ready diver, and marks a blocked one at the dock", () => {
    expect(offlineTripView(richEnvelope("trip-1"), "after_dive_1")?.blockedAtRail).toEqual([false]);
    expect(
      offlineTripView(richEnvelope("trip-1", { readiness: "blocked" }), "departure")?.blockedAtRail,
    ).toEqual([true]);
  });
});

/**
 * **A medical block after a dive, offline** (issue #2380): the same predicate
 * the live roll call reads (`medicalHoldAfterDive`), off this device's own
 * taps as well as the saved copy, so the two never disagree.
 */
describe("offlineTripView — a medical block after a dive", () => {
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
  function medicallyBlocked(events: OfflineRollCallEvent[]) {
    const envelope = richEnvelope("trip-1", { readiness: "blocked" }, { events });
    for (const manifest of envelope.snapshot.manifests) {
      for (const diver of manifest.divers) {
        if (diver.readiness.status === "blocked") {
          diver.readiness.blockers = [
            { code: "medical_not_cleared", text: "Physician did not clear" },
          ];
        }
      }
    }
    return envelope;
  }

  it("names it for a diver this device boarded over it at the dock", () => {
    const view = offlineTripView(medicallyBlocked([boardedAtDock]), "after_dive_1");
    expect(view?.medicalHold).toEqual(["medical_not_cleared"]);
    expect(view?.blockedAtRail).toEqual([false]);
  });

  it("stays quiet at the dock and for a diver nobody boarded, where Blocked speaks", () => {
    expect(offlineTripView(medicallyBlocked([boardedAtDock]), "departure")?.medicalHold).toEqual([
      null,
    ]);
    const unboarded = offlineTripView(medicallyBlocked([]), "after_dive_1");
    expect(unboarded?.medicalHold).toEqual([null]);
    expect(unboarded?.blockedAtRail).toEqual([true]);
  });

  it("gives way to the not-back alarm", () => {
    const notBack: OfflineRollCallEvent = {
      ...boardedAtDock,
      clientEventId: "event-2",
      checkpoint: "after_dive_1",
      status: "not_boarded",
      occurredAt: "2026-08-01T14:10:00.000Z",
    };
    expect(
      offlineTripView(medicallyBlocked([boardedAtDock, notBack]), "after_dive_1")?.medicalHold,
    ).toEqual([null]);
  });
});
