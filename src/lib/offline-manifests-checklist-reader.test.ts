import { describe, expect, it } from "vitest";
import { snapshot } from "../test/substrate-fixtures/lib/offline-manifests-fixtures";
import {
  latestOfflineChecklistCheck,
  type OfflineChecklistEvent,
  type OfflineManifestSnapshot,
} from "./offline-manifests";

const ITEM = "item-oxygen";

function copy(check?: { occurredAt: string }): OfflineManifestSnapshot {
  const saved = snapshot();
  saved.checklist = {
    items: [
      {
        id: ITEM,
        label: "Emergency oxygen aboard",
        ...(check
          ? { check: { state: "checked", recordedByName: "Sal Ortiz", note: null, ...check } }
          : {}),
      },
    ],
  };
  return saved;
}

function tap(
  saved: OfflineManifestSnapshot,
  fields: Pick<OfflineChecklistEvent, "status" | "occurredAt" | "syncStatus">,
): OfflineChecklistEvent {
  return {
    clientEventId: `event-${fields.occurredAt}`,
    snapshotId: saved.snapshotId,
    snapshotSavedAt: saved.savedAt,
    tripId: "trip-1",
    checklistItemId: ITEM,
    note: null,
    ...fields,
  };
}

describe("the boat check as this tablet reads it", () => {
  it("shows this tablet's own tick while it waits to sync and once it has", () => {
    const saved = copy();
    for (const syncStatus of ["pending", "applied"] as const) {
      const mine = tap(saved, {
        status: "checked",
        occurredAt: "2026-07-20T11:30:00.000Z",
        syncStatus,
      });
      expect(latestOfflineChecklistCheck(saved, ITEM, [mine])).toMatchObject({
        state: "checked",
        local: true,
        pending: syncStatus === "pending",
      });
    }
  });

  it("does not show a tick DiveDay refused", () => {
    const saved = copy();
    const refused = tap(saved, {
      status: "checked",
      occurredAt: "2026-07-20T11:30:00.000Z",
      syncStatus: "rejected",
    });
    expect(latestOfflineChecklistCheck(saved, ITEM, [refused])).toBeUndefined();
  });

  it("keeps the saved tick when this tablet's undo of it was refused", () => {
    const saved = copy({ occurredAt: "2026-07-20T11:20:00.000Z" });
    const refused = tap(saved, {
      status: "cleared",
      occurredAt: "2026-07-20T11:30:00.000Z",
      syncStatus: "rejected",
    });
    expect(latestOfflineChecklistCheck(saved, ITEM, [refused])).toMatchObject({
      state: "checked",
      local: false,
    });
  });

  it("shows a tick somebody else made after this tablet unticked the item", () => {
    const saved = copy({ occurredAt: "2026-07-20T11:40:00.000Z" });
    const mine = tap(saved, {
      status: "cleared",
      occurredAt: "2026-07-20T11:30:00.000Z",
      syncStatus: "applied",
    });
    expect(latestOfflineChecklistCheck(saved, ITEM, [mine])).toMatchObject({
      state: "checked",
      occurredAt: "2026-07-20T11:40:00.000Z",
      local: false,
    });
  });

  it("keeps this tablet's undo over the older saved tick it took back", () => {
    const saved = copy({ occurredAt: "2026-07-20T11:20:00.000Z" });
    const mine = tap(saved, {
      status: "cleared",
      occurredAt: "2026-07-20T11:30:00.000Z",
      syncStatus: "pending",
    });
    expect(latestOfflineChecklistCheck(saved, ITEM, [mine])).toBeUndefined();
  });
});
