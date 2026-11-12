import { describe, expect, it } from "vitest";
import { snapshot } from "@/test/substrate-fixtures/lib/offline-manifests-fixtures";
import {
  latestOfflineChecklistCheck,
  latestOfflineRollCall,
  type OfflineChecklistEvent,
  type OfflineRollCallEvent,
} from "./offline-manifests";

describe("server time and device queue order", () => {
  const tap = (fields: Partial<OfflineRollCallEvent>): OfflineRollCallEvent => ({
    clientEventId: crypto.randomUUID(),
    snapshotId: "snapshot",
    snapshotSavedAt: "2026-07-20T13:00:00.000Z",
    tripId: "trip-1",
    bookingId: "ready",
    checkpoint: "after_dive_1",
    status: "boarded",
    occurredAt: "2026-07-20T14:10:00.000Z",
    syncStatus: "applied",
    ...fields,
  });
  it("compares a fast device's synced tap with the saved alarm using its stored instant", () => {
    const copy = snapshot();
    const row = copy.manifests
      .find((m) => m.checkpoint === "after_dive_1")
      ?.divers.find((d) => d.bookingId === "ready");
    if (!row) throw new Error("fixture lost diver");
    row.rollCall = {
      state: "not_boarded",
      occurredAt: "2026-07-20T14:05:00.000Z",
      recordedByName: "Sal",
    };
    const event = tap({ storedOccurredAt: "2026-07-20T14:00:00.000Z" });
    expect(latestOfflineRollCall(copy, [event], "ready", "after_dive_1")).toMatchObject({
      state: "not_boarded",
      local: false,
    });
  });
  it("does not reorder an applied aboard ahead of a later pending alarm on a slow tablet", () => {
    const events = [
      tap({ occurredAt: "2026-07-20T13:57:00.000Z", storedOccurredAt: "2026-07-20T14:00:00.000Z" }),
      tap({ occurredAt: "2026-07-20T13:59:00.000Z", status: "not_boarded", syncStatus: "pending" }),
    ];
    expect(latestOfflineRollCall(snapshot(), events, "ready", "after_dive_1")).toMatchObject({
      state: "not_boarded",
      pending: true,
    });
  });
  it("lets a later pending alarm supersede the saved copy of this device's own applied mark", () => {
    const copy = snapshot();
    copy.erasureEpochToken = `3.9.${"a".repeat(43)}`;
    const row = copy.manifests
      .find((m) => m.checkpoint === "after_dive_1")
      ?.divers.find((d) => d.bookingId === "ready");
    if (!row) throw new Error("fixture lost diver");
    row.rollCall = {
      state: "boarded",
      occurredAt: "2026-07-20T14:00:00.000Z",
      recordedByName: "Sal",
    };
    const events = [
      tap({
        occurredAt: "2026-07-20T13:57:00.000Z",
        storedOccurredAt: "2026-07-20T14:00:00.000Z",
        syncedAtRevision: 7,
      }),
      tap({ occurredAt: "2026-07-20T13:59:00.000Z", status: "not_boarded", syncStatus: "pending" }),
    ];
    expect(latestOfflineRollCall(copy, events, "ready", "after_dive_1")).toMatchObject({
      state: "not_boarded",
      pending: true,
    });
  });
  it("does not let a pending aboard use the causal exception to silence a saved alarm", () => {
    const copy = snapshot();
    copy.erasureEpochToken = `3.9.${"a".repeat(43)}`;
    const row = copy.manifests
      .find((manifest) => manifest.checkpoint === "after_dive_1")
      ?.divers.find((diver) => diver.bookingId === "ready");
    if (!row) throw new Error("fixture lost diver");
    row.rollCall = {
      state: "not_boarded",
      occurredAt: "2026-07-20T14:00:00.000Z",
      recordedByName: "Sal",
    };
    const events = [
      tap({
        status: "not_boarded",
        occurredAt: "2026-07-20T13:57:00.000Z",
        storedOccurredAt: "2026-07-20T14:00:00.000Z",
        syncedAtRevision: 7,
      }),
      tap({ occurredAt: "2026-07-20T13:59:00.000Z", syncStatus: "pending" }),
    ];
    expect(latestOfflineRollCall(copy, events, "ready", "after_dive_1")).toMatchObject({
      state: "not_boarded",
      pending: false,
    });
  });
  it("keeps the offline undo when the saved copy holds this device's committed instant", () => {
    const copy = snapshot();
    copy.erasureEpochToken = `3.9.${"a".repeat(43)}`;
    const row = copy.manifests
      .find((manifest) => manifest.checkpoint === "after_dive_1")
      ?.divers.find((diver) => diver.bookingId === "ready");
    if (!row) throw new Error("fixture lost diver");
    row.rollCall = {
      state: "boarded",
      occurredAt: "2026-07-20T14:00:00.000Z",
      recordedByName: "Sal",
    };
    const event = tap({
      storedOccurredAt: "2026-07-20T14:00:00.000Z",
      syncedAtRevision: 7,
    });
    expect(latestOfflineRollCall(copy, [event], "ready", "after_dive_1")).toMatchObject({
      state: "boarded",
      occurredAt: event.storedOccurredAt,
      clientEventId: event.clientEventId,
      local: true,
    });
  });
  it("files a synced alarm under its committed meeting day and ignores refused or other-diver corrections", () => {
    const copy = snapshot();
    copy.rollCallDayBoundaries = ["2026-07-21T00:00:00.000Z"];
    const alarm = tap({
      status: "not_boarded",
      occurredAt: "2026-07-21T00:03:00.000Z",
      storedOccurredAt: "2026-07-20T23:58:00.000Z",
    });
    const events = [
      alarm,
      tap({
        status: "boarded",
        occurredAt: "2026-07-20T23:59:00.000Z",
        syncStatus: "rejected",
      }),
      tap({
        bookingId: "blocked",
        status: "boarded",
        occurredAt: "2026-07-20T23:59:00.000Z",
      }),
    ];
    expect(
      latestOfflineRollCall(
        copy,
        events,
        "ready",
        "after_dive_1",
        new Date("2026-07-21T14:00:00.000Z"),
      ),
    ).toMatchObject({ state: "not_boarded", local: false, occurredAt: alarm.storedOccurredAt });
  });
  it("orders local checklist taps by raw time and compares the winning tap to saved server time", () => {
    const copy = snapshot();
    copy.checklist = {
      items: [
        {
          id: "oxygen",
          label: "Oxygen aboard",
          check: {
            state: "checked",
            occurredAt: "2026-07-20T14:02:00.000Z",
            recordedByName: "Sal",
            note: null,
          },
        },
      ],
    };
    const base = {
      snapshotId: copy.snapshotId,
      snapshotSavedAt: copy.savedAt,
      tripId: "trip-1",
      checklistItemId: "oxygen",
      syncStatus: "applied" as const,
      note: null,
    };
    const events: OfflineChecklistEvent[] = [
      {
        ...base,
        clientEventId: "newer",
        status: "checked",
        occurredAt: "2026-07-20T13:59:00.000Z",
        storedOccurredAt: "2026-07-20T14:03:00.000Z",
      },
      {
        ...base,
        clientEventId: "older",
        status: "cleared",
        occurredAt: "2026-07-20T13:57:00.000Z",
        storedOccurredAt: "2026-07-20T14:01:00.000Z",
      },
    ];
    expect(latestOfflineChecklistCheck(copy, "oxygen", events)).toMatchObject({
      state: "checked",
      clientEventId: "newer",
      occurredAt: "2026-07-20T14:03:00.000Z",
      local: true,
    });
  });
});
