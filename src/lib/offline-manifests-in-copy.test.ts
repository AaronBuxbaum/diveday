import { describe, expect, it } from "vitest";
import { snapshot } from "../test/substrate-fixtures/lib/offline-manifests-fixtures";
import {
  latestOfflineArrival,
  latestOfflineChecklistCheck,
  latestOfflineRollCall,
  type OfflineManifestSnapshot,
  offlineEventInCopy,
  offlineSnapshotTokenClaims,
} from "./offline-manifests";
import { clientRollCallEvidenceId } from "./roll-call-causality";

const ITEM = "item-oxygen";

/** A copy issued at this snapshot revision, shaped as `signOfflineErasureEpoch` signs one. */
function copyAt(revision: number): OfflineManifestSnapshot {
  const saved = snapshot();
  saved.erasureEpochToken = `3.${revision}.${"a".repeat(43)}`;
  saved.checklist = { items: [{ id: ITEM, label: "Emergency oxygen aboard" }] };
  return saved;
}

function base(saved: OfflineManifestSnapshot) {
  return {
    clientEventId: "event-1",
    snapshotId: saved.snapshotId,
    snapshotSavedAt: saved.savedAt,
    tripId: "trip-1",
    occurredAt: "2026-07-20T14:00:00.000Z",
    syncStatus: "applied" as const,
    // DiveDay answered for it when the departure's revision was 7.
    syncedAtRevision: 7,
  };
}

/**
 * This tablet's tap reached DiveDay, and somebody then undid it on the live
 * manifest. An undone mark leaves nothing in the saved copy, so only knowing
 * that the copy was read after the tap lets the tablet stop showing it.
 */
describe("a synced tap that was undone on the live manifest", () => {
  it("reads the token's revision, and nothing from a token in another shape", () => {
    expect(offlineSnapshotTokenClaims(copyAt(9).erasureEpochToken)).toEqual({
      epoch: 3,
      revision: 9,
    });
    expect(offlineSnapshotTokenClaims(undefined)).toBeNull();
    expect(offlineSnapshotTokenClaims("3.9.short")).toBeNull();
    expect(offlineSnapshotTokenClaims(`3.0.${"a".repeat(43)}`)).toBeNull();
  });

  it("stops showing 'back aboard' once the copy is two revisions past the sync", () => {
    const saved = copyAt(9);
    const mine = {
      ...base(saved),
      bookingId: "ready",
      checkpoint: "after_dive_1" as const,
      status: "boarded" as const,
      note: null,
    };
    expect(latestOfflineRollCall(saved, [mine], "ready", "after_dive_1")).toBeUndefined();
  });

  it("stops showing a tick on the boat check, and an arrival at the counter", () => {
    const saved = copyAt(9);
    const tick = { ...base(saved), checklistItemId: ITEM, status: "checked" as const, note: null };
    expect(latestOfflineChecklistCheck(saved, ITEM, [tick])).toBeUndefined();
    const arrival = { ...base(saved), bookingId: "ready", status: "arrived" as const };
    expect(latestOfflineArrival(saved, "ready", [arrival])).toBeUndefined();
  });

  /**
   * A refresh and a sync can cross at a signal blip: the copy one revision on
   * may have read its rows before the tap was written. Reading the tap as in
   * that copy would take a synced "did not come back" off the tablet that
   * raised it.
   */
  it("keeps the tablet's own alarm while the copy is only one revision on", () => {
    const saved = copyAt(8);
    const alarm = {
      ...base(saved),
      bookingId: "ready",
      checkpoint: "after_dive_1" as const,
      status: "not_boarded" as const,
      note: null,
    };
    expect(offlineEventInCopy(saved, alarm)).toBe(false);
    expect(latestOfflineRollCall(saved, [alarm], "ready", "after_dive_1")).toMatchObject({
      state: "not_boarded",
      local: true,
    });
  });

  it("keeps the undo on this tablet's own mark when the copy shows exactly that mark", () => {
    const saved = copyAt(9);
    const diver = saved.manifests
      .find((manifest) => manifest.checkpoint === "after_dive_1")
      ?.divers.find((entry) => entry.bookingId === "ready");
    if (!diver) throw new Error("fixture lost its diver");
    diver.rollCall = {
      state: "boarded",
      occurredAt: "2026-07-20T14:00:00.000Z",
      recordedByName: "Dana Divemaster",
    };
    const mine = {
      ...base(saved),
      bookingId: "ready",
      checkpoint: "after_dive_1" as const,
      status: "boarded" as const,
      note: null,
    };
    const ownId = clientRollCallEvidenceId(mine.clientEventId);
    diver.rollCallContext = {
      meetingDay: 0,
      observedEvidenceIds: [ownId],
      conflict: false,
      orderingUnknown: false,
      unknownMeetingDay: false,
      evidence: [
        {
          id: ownId,
          status: "boarded",
          occurredAt: diver.rollCall.occurredAt,
          recordedByName: diver.rollCall.recordedByName,
          note: null,
          meetingDay: 0,
          observedEvidenceIds: [],
        },
      ],
    };
    // The saved identity, rather than a matching clock, names this tablet's tap.
    expect(latestOfflineRollCall(saved, [mine], "ready", "after_dive_1")).toMatchObject({
      state: "boarded",
      pending: false,
      local: true,
      clientEventId: "event-1",
    });
  });

  it("shows the copy's own word for an alarm it holds, as somebody else's to undo", () => {
    const saved = copyAt(9);
    const diver = saved.manifests
      .find((manifest) => manifest.checkpoint === "after_dive_1")
      ?.divers.find((entry) => entry.bookingId === "ready");
    if (!diver) throw new Error("fixture lost its diver");
    // Somebody else said it again five minutes after this tablet did.
    diver.rollCall = {
      state: "not_boarded",
      occurredAt: "2026-07-20T14:05:00.000Z",
      recordedByName: "Dana Divemaster",
    };
    const alarm = {
      ...base(saved),
      bookingId: "ready",
      checkpoint: "after_dive_1" as const,
      status: "not_boarded" as const,
      note: null,
    };
    expect(latestOfflineRollCall(saved, [alarm], "ready", "after_dive_1")).toMatchObject({
      state: "not_boarded",
      local: false,
    });
  });

  it("never reads a tap as in the copy without a revision on both sides", () => {
    const tap = { syncStatus: "applied" as const, syncedAtRevision: 7 };
    expect(offlineEventInCopy(copyAt(9), tap)).toBe(true);
    expect(offlineEventInCopy(snapshot(), tap)).toBe(false);
    expect(offlineEventInCopy(copyAt(9), { syncStatus: "applied" })).toBe(false);
    expect(offlineEventInCopy(copyAt(9), { ...tap, syncStatus: "pending" })).toBe(false);
    expect(offlineEventInCopy(copyAt(9), { ...tap, syncStatus: "rejected" })).toBe(false);
  });
});
