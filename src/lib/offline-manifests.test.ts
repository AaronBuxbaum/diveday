import { describe, expect, it } from "vitest";
import type { TripManifest } from "./manifests";
import {
  canRecordOfflineStatus,
  latestOfflineRollCall,
  OFFLINE_MANIFEST_RECORD_VERSION,
  type OfflineManifestSnapshot,
  offlineManifestExpiresAt,
  offlineManifestFreshness,
  serializeManifests,
} from "./offline-manifests";

function snapshot(): OfflineManifestSnapshot {
  return {
    version: OFFLINE_MANIFEST_RECORD_VERSION,
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
        summary: { totalDivers: 2, ready: 1, blocked: 1, boarded: 0, notBoarded: 0, awaiting: 2 },
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
      implied: false,
    });
  });

  it("surfaces a carried-forward not-boarded from the snapshot as implied", () => {
    const saved = snapshot();
    saved.manifests[0]?.divers.push({
      bookingId: "carried",
      fullName: "Carried Diver",
      email: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      readiness: { status: "ready", blockers: [] },
      rentalFit: { state: "not_recorded", text: "No fit on file — not asked yet" },
      nitroxRequested: false,
      rollCall: {
        state: "not_boarded",
        occurredAt: "2026-07-20T11:02:00.000Z",
        recordedByName: "Dana Divemaster",
        note: "Left after dive 1",
        implied: true,
      },
    });

    const carried = latestOfflineRollCall(saved, [], "carried", "departure");
    expect(carried).toEqual({
      state: "not_boarded",
      occurredAt: "2026-07-20T11:02:00.000Z",
      pending: false,
      implied: true,
    });
  });

  it("treats a device-recorded not-boarded as explicit, never carried", () => {
    const saved = snapshot();
    const latest = latestOfflineRollCall(
      saved,
      [
        {
          clientEventId: "event-2",
          snapshotId: saved.snapshotId,
          snapshotSavedAt: saved.savedAt,
          tripId: "trip-1",
          bookingId: "blocked",
          checkpoint: "departure",
          status: "not_boarded",
          note: null,
          occurredAt: "2026-07-20T11:06:00.000Z",
          syncStatus: "pending",
        },
      ],
      "blocked",
      "departure",
    );
    expect(latest?.implied).toBe(false);
  });

  it("carries the implied flag through serialization", () => {
    const manifest: TripManifest = {
      trip: {
        id: "trip-1",
        title: "Two-Tank Reef",
        startsAt: new Date("2026-07-20T12:00:00.000Z"),
        endsAt: new Date("2026-07-20T16:00:00.000Z"),
        plannedDives: 2,
      },
      checkpoint: "after_dive_1",
      crew: [],
      divers: [
        {
          bookingId: "carried",
          fullName: "Carried Diver",
          email: "carried@example.com",
          emergencyContactName: null,
          emergencyContactPhone: null,
          readiness: { status: "ready", blockers: [] },
          rentalFit: { state: "own_kit", text: "Own kit" },
          nitroxRequested: false,
          rollCall: {
            state: "not_boarded",
            occurredAt: new Date("2026-07-20T13:30:00.000Z"),
            recordedByName: "Dana Divemaster",
            note: null,
            implied: true,
          },
        },
      ],
      summary: { totalDivers: 1, ready: 1, blocked: 0, boarded: 0, notBoarded: 1, awaiting: 0 },
    };

    const payload = serializeManifests([manifest], {
      slug: "blue-mantis",
      name: "Blue Mantis",
      timezone: "America/New_York",
    });
    expect(payload.manifests[0]?.divers[0]?.rollCall).toEqual({
      state: "not_boarded",
      occurredAt: "2026-07-20T13:30:00.000Z",
      recordedByName: "Dana Divemaster",
      note: null,
      implied: true,
    });
    // Private data the dock does not need is still dropped.
    expect(payload.manifests[0]?.divers[0]?.email).toBeNull();
  });
});
