import { describe, expect, it } from "vitest";
import {
  canRecordOfflineStatus,
  latestOfflineRollCall,
  type OfflineManifestSnapshot,
  offlineManifestExpiresAt,
  offlineManifestFreshness,
} from "./offline-manifests";

function snapshot(): OfflineManifestSnapshot {
  return {
    version: 2,
    snapshotId: "snapshot-1",
    savedAt: "2026-07-20T11:00:00.000Z",
    expiresAt: "2026-07-27T16:00:00.000Z",
    shop: { slug: "blue-mantis", name: "Blue Mantis", timezone: "America/New_York" },
    manifests: [
      {
        trip: {
          id: "trip-1",
          title: "Two-Tank Reef",
          startsAt: "2026-07-20T12:00:00.000Z",
          endsAt: "2026-07-20T16:00:00.000Z",
          plannedDives: 2,
        },
        checkpoint: "departure",
        crew: [],
        summary: { totalDivers: 2, ready: 1, blocked: 1, boarded: 0, awaiting: 2 },
        divers: [
          {
            bookingId: "ready",
            fullName: "Ready Diver",
            email: null,
            emergencyContactName: null,
            emergencyContactPhone: null,
            readiness: { status: "ready", blockers: [] },
            rentalFit: { state: "not_recorded" as const, text: "No fit on file — not asked yet" },
            nitroxRequested: false,
          },
          {
            bookingId: "blocked",
            fullName: "Blocked Diver",
            email: null,
            emergencyContactName: null,
            emergencyContactPhone: null,
            readiness: {
              status: "blocked",
              blockers: [{ code: "waiver_pending", message: "Waiver pending." }],
            },
            rentalFit: { state: "not_recorded" as const, text: "No fit on file — not asked yet" },
            nitroxRequested: false,
          },
        ],
      },
    ],
  };
}

describe("offline manifest policy", () => {
  it("labels freshness without hiding an old snapshot", () => {
    const saved = new Date("2026-07-20T11:00:00.000Z");
    expect(offlineManifestFreshness(saved, new Date("2026-07-20T11:10:00.000Z"))).toBe("current");
    expect(offlineManifestFreshness(saved, new Date("2026-07-20T13:00:00.000Z"))).toBe("aging");
    expect(offlineManifestFreshness(saved, new Date("2026-07-20T20:00:00.000Z"))).toBe("stale");
  });

  it("expires at the earlier privacy boundary", () => {
    const saved = new Date("2026-07-20T11:00:00.000Z");
    expect(offlineManifestExpiresAt(saved, new Date("2026-07-20T16:00:00.000Z"))).toEqual(
      new Date("2026-07-27T16:00:00.000Z"),
    );
  });

  it("never lets a snapshot board a missing or blocked diver", () => {
    const saved = snapshot();
    expect(canRecordOfflineStatus(saved, "ready", "boarded")).toBe(true);
    expect(canRecordOfflineStatus(saved, "blocked", "boarded")).toBe(false);
    expect(canRecordOfflineStatus(saved, "blocked", "not_boarded")).toBe(true);
    expect(canRecordOfflineStatus(saved, "missing", "not_boarded")).toBe(false);
  });

  it("uses the latest non-rejected device event and exposes pending state", () => {
    const saved = snapshot();
    const latest = latestOfflineRollCall(
      saved,
      [
        {
          clientEventId: "event-1",
          snapshotId: saved.snapshotId,
          snapshotSavedAt: saved.savedAt,
          tripId: "trip-1",
          bookingId: "ready",
          checkpoint: "departure",
          status: "boarded",
          note: null,
          occurredAt: "2026-07-20T11:05:00.000Z",
          syncStatus: "pending",
        },
      ],
      "ready",
      "departure",
    );
    expect(latest).toEqual({
      state: "boarded",
      occurredAt: "2026-07-20T11:05:00.000Z",
      pending: true,
    });
  });
});
