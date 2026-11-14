import { describe, expect, it } from "vitest";
import { verifiedFixture } from "@/test/verified-offline-meeting";
import { crewSnapshot, snapshot } from "../test/substrate-fixtures/lib/offline-manifests-fixtures";
import {
  latestOfflineCrewRollCall,
  latestOfflineRollCall,
  type OfflineManifestSnapshot,
  type OfflineRollCallEvent,
} from "./offline-manifests";

/**
 * A two-device boat with retained copies that predate causal context. Capture
 * clocks cannot prove either crew member observed the other statement. Opposed
 * evidence remains visible until named reconciliation, in either clock order.
 */
function tap(
  saved: OfflineManifestSnapshot,
  fields: Pick<OfflineRollCallEvent, "status" | "occurredAt" | "syncStatus"> &
    Partial<OfflineRollCallEvent>,
): OfflineRollCallEvent {
  return {
    clientEventId: `event-${fields.occurredAt}`,
    snapshotId: saved.snapshotId,
    snapshotSavedAt: saved.savedAt,
    tripId: "trip-1",
    bookingId: "ready",
    checkpoint: "after_dive_1",
    note: null,
    ...fields,
  };
}

/** The copy as refreshed at 14:10, holding the other device's 14:05 statement. */
function refreshed(state: "boarded" | "not_boarded"): OfflineManifestSnapshot {
  const saved = snapshot();
  saved.savedAt = "2026-07-20T14:10:00.000Z";
  const diver = saved.manifests
    .find((manifest) => manifest.checkpoint === "after_dive_1")
    ?.divers.find((entry) => entry.bookingId === "ready");
  if (!diver) throw new Error("fixture lost its diver");
  diver.rollCall = { state, occurredAt: "2026-07-20T14:05:00.000Z", recordedByName: "Sal Ortiz" };
  return saved;
}

describe("opaque saved evidence and this tablet's own evidence", () => {
  it("shows the other device's 'did not come back' over this tablet's synced 'back aboard'", () => {
    const saved = refreshed("not_boarded");
    const mine = tap(saved, {
      status: "boarded",
      occurredAt: "2026-07-20T14:00:00.000Z",
      syncStatus: "applied",
    });
    expect(latestOfflineRollCall(saved, [mine], "ready", "after_dive_1")).toMatchObject({
      state: "not_boarded",
      occurredAt: "2026-07-20T14:05:00.000Z",
      local: false,
      evidenceConflict: true,
    });
  });

  it("shows it over this tablet's synced undo, which was about an earlier mark", () => {
    const saved = refreshed("not_boarded");
    const events = [
      tap(saved, {
        status: "boarded",
        occurredAt: "2026-07-20T13:58:00.000Z",
        syncStatus: "applied",
      }),
      tap(saved, {
        status: "cleared",
        occurredAt: "2026-07-20T14:00:00.000Z",
        syncStatus: "applied",
      }),
    ];
    expect(latestOfflineRollCall(saved, events, "ready", "after_dive_1")).toMatchObject({
      state: "not_boarded",
      local: false,
      evidenceConflict: true,
    });
  });

  it("preserves the saved missing evidence against an unobserved pending aboard statement", () => {
    const { saved, tripId, meetingIdentityProof } = verifiedFixture(refreshed("not_boarded"));
    const mine = tap(saved, {
      status: "boarded",
      occurredAt: "2026-07-20T14:00:00.000Z",
      syncStatus: "pending",
      tripId,
      meetingDay: 0,
      meetingIdentityProof,
    });
    expect(latestOfflineRollCall(saved, [mine], "ready", "after_dive_1")).toMatchObject({
      state: "not_boarded",
      local: false,
      evidenceConflict: true,
    });
  });

  it("keeps an opaque saved aboard statement conflicted with this tablet's alarm", () => {
    const saved = refreshed("boarded");
    const mine = tap(saved, {
      status: "not_boarded",
      occurredAt: "2026-07-20T14:00:00.000Z",
      syncStatus: "applied",
    });
    expect(latestOfflineRollCall(saved, [mine], "ready", "after_dive_1")).toMatchObject({
      state: "not_boarded",
      local: false,
      evidenceConflict: true,
    });
  });

  /**
   * At the dock "not boarded" means never left, and it carries forward as
   * accounted for. A diver the desk boarded after this tablet's dock mark is in
   * the water, so the later checkpoints must wait for a count.
   */
  it("reopens the after-dive counts when the desk boarded a diver this tablet marked ashore", () => {
    const saved = snapshot();
    saved.savedAt = "2026-07-20T12:10:00.000Z";
    const dock = saved.manifests
      .find((manifest) => manifest.checkpoint === "departure")
      ?.divers.find((entry) => entry.bookingId === "ready");
    if (!dock) throw new Error("fixture lost its diver");
    dock.rollCall = {
      state: "boarded",
      occurredAt: "2026-07-20T12:05:00.000Z",
      recordedByName: "Sal Ortiz",
    };
    const mine = tap(saved, {
      checkpoint: "departure",
      status: "not_boarded",
      occurredAt: "2026-07-20T11:55:00.000Z",
      syncStatus: "applied",
    });
    expect(latestOfflineRollCall(saved, [mine], "ready", "departure")).toMatchObject({
      state: "boarded",
      local: false,
      evidenceConflict: true,
    });
    expect(latestOfflineRollCall(saved, [mine], "ready", "after_dive_1")).toBeUndefined();
  });

  it("keeps this tablet's pending alarm visible without claiming clock-based precedence", () => {
    const saved = refreshed("boarded");
    const mine = tap(saved, {
      status: "not_boarded",
      occurredAt: "2026-07-20T14:20:00.000Z",
      syncStatus: "pending",
    });
    expect(latestOfflineRollCall(saved, [mine], "ready", "after_dive_1")).toMatchObject({
      state: "not_boarded",
      local: false,
      evidenceConflict: true,
      pending: true,
    });
  });

  it("reads the crew half of the count the same way", () => {
    const saved = crewSnapshot();
    saved.savedAt = "2026-07-20T14:10:00.000Z";
    const member = saved.manifests
      .find((manifest) => manifest.checkpoint === "after_dive_1")
      ?.crew.find((entry) => entry.id === "crew-dana");
    if (!member) throw new Error("fixture lost its crew");
    member.rollCall = {
      state: "not_boarded",
      occurredAt: "2026-07-20T14:05:00.000Z",
      recordedByName: "Sal Ortiz",
    };
    const mine = tap(saved, {
      bookingId: undefined,
      crewPersonId: "crew-dana",
      status: "boarded",
      occurredAt: "2026-07-20T14:00:00.000Z",
      syncStatus: "applied",
    });
    expect(latestOfflineCrewRollCall(saved, [mine], "crew-dana", "after_dive_1")).toMatchObject({
      state: "not_boarded",
      local: false,
      evidenceConflict: true,
    });
  });
});
