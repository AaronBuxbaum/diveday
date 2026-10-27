import { describe, expect, it } from "vitest";
import { EMPTY_EMERGENCY_REFERENCE } from "./emergency-reference";
import { rollCallCheckpoints } from "./manifests";
import {
  canRecordOfflineStatus,
  OFFLINE_MANIFEST_RECORD_VERSION,
  type OfflineManifestSnapshot,
} from "./offline-manifests";

/**
 * One manifest per checkpoint, the way a real snapshot is built: the payload
 * comes from `getTripManifests`, which returns the whole `rollCallCheckpoints`
 * list for the trip's planned-dive count. The fixture used to carry only the
 * "departure" manifest, which is what let `canRecordOfflineStatus` read
 * `manifests[0]` for years without a test noticing (DOM-L4).
 */
function snapshot(): OfflineManifestSnapshot {
  const checkpoints = ["departure", "after_dive_1", "after_dive_2"] as const;
  return {
    version: OFFLINE_MANIFEST_RECORD_VERSION,
    snapshotId: "snapshot-1",
    savedAt: "2026-07-20T11:00:00.000Z",
    expiresAt: "2026-07-27T16:00:00.000Z",
    shop: {
      slug: "blue-mantis",
      name: "Blue Mantis",
      timezone: "America/New_York",
      emergencyReference: EMPTY_EMERGENCY_REFERENCE,
    },
    manifests: checkpoints.map((checkpoint) => ({
      trip: {
        id: "trip-1",
        title: "Two-Tank Reef",
        startsAt: "2026-07-20T12:00:00.000Z",
        endsAt: "2026-07-20T16:00:00.000Z",
        plannedDives: 2,
      },
      checkpoint,
      crew: [],
      summary: {
        totalDivers: 2,
        ready: 1,
        blocked: 1,
        boarded: 0,
        notBoarded: 0,
        notBackAboard: 0,
        awaiting: 2,
        unaccountedFor: 2,
        overCapacity: 0,
        notHere: 0,
      },
      divers: [
        {
          bookingId: "ready",
          fullName: "Ready Diver",
          email: null,
          emergencyContactName: null,
          emergencyContactPhone: null,
          readiness: { status: "ready", blockers: [] },
          rentalFit: { state: "not_recorded" as const },
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
            blockers: [{ code: "waiver_pending", text: "Waiver pending." }],
          },
          rentalFit: { state: "not_recorded" as const },
          nitroxRequested: false,
        },
      ],
    })),
  };
}

describe("five-dive offline manifest", () => {
  it("can record the fifth head count from a saved five-dive manifest", () => {
    const saved = snapshot();
    const template = saved.manifests[0];
    if (!template) throw new Error("missing manifest fixture");
    saved.manifests = rollCallCheckpoints(5).map((checkpoint) => ({
      ...template,
      checkpoint,
      trip: { ...template.trip, plannedDives: 5 },
    }));
    expect(canRecordOfflineStatus(saved, "blocked", "boarded", "after_dive_5")).toBe(true);
    expect(canRecordOfflineStatus(saved, "missing", "boarded", "after_dive_5")).toBe(false);
    expect(canRecordOfflineStatus(saved, "blocked", "boarded", "after_dive_6")).toBe(false);
  });
});
