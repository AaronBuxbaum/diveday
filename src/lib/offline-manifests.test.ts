import { describe, expect, it } from "vitest";
import type { TripManifest } from "./manifests";
import {
  canRecordOfflineStatus,
  isOfflineManifestExpired,
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

  it("treats a snapshot as expired only once its expiresAt has actually passed", () => {
    const saved = snapshot();
    expect(saved.expiresAt).toBe("2026-07-27T16:00:00.000Z");
    expect(isOfflineManifestExpired(saved, new Date("2026-07-27T15:59:59.000Z"))).toBe(false);
    expect(isOfflineManifestExpired(saved, new Date("2026-07-27T16:00:00.000Z"))).toBe(true);
    expect(isOfflineManifestExpired(saved, new Date("2026-08-01T00:00:00.000Z"))).toBe(true);
  });

  it("never lets a snapshot board a missing or blocked diver at departure", () => {
    const saved = snapshot();
    expect(canRecordOfflineStatus(saved, "ready", "boarded", "departure")).toBe(true);
    expect(canRecordOfflineStatus(saved, "blocked", "boarded", "departure")).toBe(false);
    expect(canRecordOfflineStatus(saved, "blocked", "not_boarded", "departure")).toBe(true);
    expect(canRecordOfflineStatus(saved, "missing", "not_boarded", "departure")).toBe(false);
  });

  // Dive-domain-expert review (docs/product/assessments/ux-personas-20260730.md,
  // persona 10 Sal, task 72, invariant 2): the UI shows a live "Board" button
  // after any numbered dive regardless of readiness (`ready || !isDeparture`
  // in OfflineManifestView) because post-departure roll call is a pure head
  // count. `canRecordOfflineStatus` is the real fail-closed authority and
  // must agree — it used to ignore checkpoint entirely and always re-check
  // readiness, silently refusing exactly the board the UI implies will
  // succeed. This mirrors the server's own gate (`recordRollCall` in
  // src/db/manifests.ts: `status === "boarded" && checkpoint === "departure"`).
  it("still allows boarding a not-ready diver after a numbered dive as a pure headcount", () => {
    const saved = snapshot();
    // A missing/uncleared medical, unresolved at departure.
    expect(canRecordOfflineStatus(saved, "blocked", "boarded", "departure")).toBe(false);
    // The same diver, same unresolved readiness, at a post-departure
    // checkpoint — must succeed. This is the case that regresses without the
    // checkpoint gate.
    expect(canRecordOfflineStatus(saved, "blocked", "boarded", "after_dive_1")).toBe(true);
    expect(canRecordOfflineStatus(saved, "blocked", "boarded", "after_dive_2")).toBe(true);
    // Readiness still gates a fresh board attempt at departure itself, even
    // when other checkpoints exist on the same snapshot.
    expect(canRecordOfflineStatus(saved, "blocked", "boarded", "departure")).toBe(false);
  });

  it("never lets an unknown bookingId board at any checkpoint", () => {
    const saved = snapshot();
    expect(canRecordOfflineStatus(saved, "missing", "boarded", "after_dive_1")).toBe(false);
    expect(canRecordOfflineStatus(saved, "missing", "not_boarded", "after_dive_1")).toBe(false);
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
      rentalFit: { state: "not_recorded" },
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
          rentalFit: { state: "own_kit" },
          nitroxRequested: false,
          checkedIn: false,
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

    const payload = serializeManifests(
      [manifest],
      { slug: "blue-mantis", name: "Blue Mantis", timezone: "America/New_York" },
      (blocker) => blocker.code,
    );
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

  it("never writes age, minor status, or birthdays to a crew device", () => {
    // H-21 put these on the roster and the live manifest — staff screens. The
    // offline copy is different: it persists to a personal phone for up to two
    // weeks with no delete button, nothing renders these fields there, and they
    // describe children. The payload type is an allow-list so a future field
    // can't repeat the mistake; this asserts the behaviour that type protects.
    const manifest: TripManifest = {
      trip: {
        id: "trip-1",
        title: "Two-Tank Reef",
        startsAt: new Date("2026-07-20T12:00:00.000Z"),
        endsAt: new Date("2026-07-20T16:00:00.000Z"),
        plannedDives: 2,
      },
      checkpoint: "departure",
      crew: [],
      divers: [
        {
          bookingId: "booking-1",
          fullName: "Lena Fischer",
          email: "lena@example.com",
          emergencyContactName: null,
          emergencyContactPhone: null,
          readiness: { status: "ready", blockers: [] },
          rentalFit: { state: "own_kit" },
          nitroxRequested: false,
          checkedIn: false,
          age: 12,
          minor: true,
          birthday: { status: "today" },
          rollCall: undefined,
        },
      ],
      summary: { totalDivers: 1, ready: 1, blocked: 0, boarded: 0, notBoarded: 0, awaiting: 1 },
    };

    const payload = serializeManifests(
      [manifest],
      { slug: "blue-mantis", name: "Blue Mantis", timezone: "America/New_York" },
      (blocker) => blocker.code,
    );
    const diver = payload.manifests[0]?.divers[0] as Record<string, unknown> | undefined;
    expect(diver).toBeDefined();
    expect(diver).not.toHaveProperty("age");
    expect(diver).not.toHaveProperty("minor");
    expect(diver).not.toHaveProperty("birthday");
    // The serialized JSON is what actually lands in IndexedDB — check there too,
    // so an inherited property could never sneak past the assertions above.
    expect(JSON.stringify(payload)).not.toContain("minor");
    expect(JSON.stringify(payload)).not.toContain("birthday");
  });
});
