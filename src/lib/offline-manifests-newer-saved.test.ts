import { describe, expect, it } from "vitest";
import { crewSnapshot, snapshot } from "../test/substrate-fixtures/lib/offline-manifests-fixtures";
import {
  latestOfflineCrewRollCall,
  latestOfflineRollCall,
  type OfflineManifestSnapshot,
  type OfflineRollCallEvent,
} from "./offline-manifests";

/**
 * A two-device boat. This tablet's own mark reached DiveDay; a second crew
 * member then said something newer about the same person on the live
 * manifest, and the tablet's next refresh brought that statement home in the
 * saved copy. The tablet keeps its own events for good, so which of the two
 * it shows is this reader's decision.
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

describe("a saved statement newer than this tablet's own", () => {
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
    });
  });

  it("shows it over a tap still waiting to sync, which DiveDay will refuse as older", () => {
    const saved = refreshed("not_boarded");
    const mine = tap(saved, {
      status: "boarded",
      occurredAt: "2026-07-20T14:00:00.000Z",
      syncStatus: "pending",
    });
    expect(latestOfflineRollCall(saved, [mine], "ready", "after_dive_1")).toMatchObject({
      state: "not_boarded",
      local: false,
    });
  });

  it("stops showing this tablet's alarm once somebody has counted the diver back since", () => {
    const saved = refreshed("boarded");
    const mine = tap(saved, {
      status: "not_boarded",
      occurredAt: "2026-07-20T14:00:00.000Z",
      syncStatus: "applied",
    });
    expect(latestOfflineRollCall(saved, [mine], "ready", "after_dive_1")).toMatchObject({
      state: "boarded",
      local: false,
    });
  });

  it("still shows this tablet's own mark when it is the newer of the two", () => {
    const saved = refreshed("boarded");
    const mine = tap(saved, {
      status: "not_boarded",
      occurredAt: "2026-07-20T14:20:00.000Z",
      syncStatus: "pending",
    });
    expect(latestOfflineRollCall(saved, [mine], "ready", "after_dive_1")).toMatchObject({
      state: "not_boarded",
      local: true,
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
    member.rollCall = { state: "not_boarded", occurredAt: "2026-07-20T14:05:00.000Z" };
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
    });
  });
});
