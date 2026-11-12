import { describe, expect, it } from "vitest";
import { clientRollCallEvidenceId } from "@/lib/roll-call-causality";
import { crewSnapshot, snapshot } from "@/test/substrate-fixtures/lib/offline-manifests-fixtures";
import {
  latestOfflineChecklistCheck,
  latestOfflineCrewRollCall,
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
  it("keeps the offline undo when the saved copy names this device's event", () => {
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
    if (!event.storedOccurredAt) throw new Error("fixture requires stored capture instant");
    row.rollCallContext = {
      meetingDay: 0,
      observedEvidenceIds: [clientRollCallEvidenceId(event.clientEventId)],
      conflict: false,
      orderingUnknown: false,
      unknownMeetingDay: false,
      evidence: [
        {
          id: clientRollCallEvidenceId(event.clientEventId),
          status: "boarded",
          occurredAt: event.storedOccurredAt,
          recordedByName: "Sal",
          note: null,
          meetingDay: 0,
        },
      ],
    };
    expect(latestOfflineRollCall(copy, [event], "ready", "after_dive_1")).toMatchObject({
      state: "boarded",
      occurredAt: event.storedOccurredAt,
      clientEventId: event.clientEventId,
      local: true,
    });
  });
  it("retains a named prior-day alarm despite capture-clock changes and unrelated corrections", () => {
    const copy = snapshot();
    copy.rollCallDayBoundaries = ["2026-07-21T00:00:00.000Z"];
    copy.rollCallMeetingDay = 0;
    copy.selectedRollCallMeetingDay = 1;
    const alarm = tap({
      status: "not_boarded",
      meetingDay: 0,
      observedEvidenceIds: [],
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
    ).toMatchObject({ state: "not_boarded", local: true, occurredAt: alarm.storedOccurredAt });
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

for (const role of ["diver", "crew"] as const) {
  it(`retains an older clock-refused missing statement for ${role} without offering a false undo`, () => {
    const copy = role === "crew" ? crewSnapshot() : snapshot();
    const crewId = copy.manifests[0].crew[0]?.id;
    if (!crewId && role === "crew") throw new Error("fixture crew missing");
    const alarm: OfflineRollCallEvent = {
      clientEventId: crypto.randomUUID(),
      tripId: "trip-1",
      snapshotId: copy.snapshotId,
      snapshotSavedAt: copy.savedAt,
      ...(role === "diver" ? { bookingId: "ready" } : { crewPersonId: crewId }),
      checkpoint: "after_dive_1",
      status: "not_boarded",
      occurredAt: "2026-07-20T13:00:00.000Z",
      syncStatus: "rejected",
      rejectionReason: "newer_event_exists",
    };
    const result =
      role === "diver"
        ? latestOfflineRollCall(copy, [alarm], "ready", "after_dive_1")
        : latestOfflineCrewRollCall(copy, [alarm], crewId ?? "unavailable-crew", "after_dive_1");
    expect(result).toMatchObject({ state: "not_boarded", local: false, pending: false });
    expect(result?.clientEventId).toBeUndefined();
  });
}

for (const role of ["diver", "crew"] as const) {
  it(`holds a refused dock exemption awaiting only within its subject/checkpoint/day for ${role}`, () => {
    const copy = crewSnapshot();
    const subject = role === "diver" ? { bookingId: "ready" } : { crewPersonId: "crew-dana" };
    const ashore: OfflineRollCallEvent = {
      ...subject,
      tripId: "trip-1",
      snapshotId: copy.snapshotId,
      snapshotSavedAt: copy.savedAt,
      clientEventId: crypto.randomUUID(),
      checkpoint: "departure",
      meetingDay: 0,
      status: "not_boarded",
      occurredAt: "2026-07-20T12:00:00.000Z",
      syncStatus: "applied",
    };
    const refused: OfflineRollCallEvent = {
      ...ashore,
      clientEventId: crypto.randomUUID(),
      status: "cleared",
      retractsClientEventId: ashore.clientEventId,
      observedEvidenceIds: [clientRollCallEvidenceId(ashore.clientEventId)],
      syncStatus: "rejected",
      rejectionReason: "retraction_superseded",
    };
    const read = (
      events: OfflineRollCallEvent[],
      checkpoint: "departure" | "after_dive_1" = "departure",
    ) =>
      role === "diver"
        ? latestOfflineRollCall(copy, events, "ready", checkpoint)
        : latestOfflineCrewRollCall(copy, events, "crew-dana", checkpoint);
    const events = [ashore, refused];
    expect(read(events)).toBeUndefined();
    expect(read(events, "after_dive_1")).toBeUndefined();
    expect(read([ashore, { ...refused, meetingDay: 1 }])).toMatchObject({ state: "not_boarded" });
    expect(read([ashore, { ...refused, checkpoint: "after_dive_2" }])).toMatchObject({
      state: "not_boarded",
    });
    expect(
      read([
        ashore,
        {
          ...refused,
          ...(role === "diver" ? { bookingId: "other" } : { crewPersonId: "crew-sal" }),
        },
      ]),
    ).toMatchObject({ state: "not_boarded" });
    const alarm: OfflineRollCallEvent = {
      ...ashore,
      checkpoint: "after_dive_1",
      clientEventId: crypto.randomUUID(),
    };
    expect(read([...events, alarm], "after_dive_1")).toMatchObject({ state: "not_boarded" });
    expect(events[1]).toEqual(refused);
    expect(events).toHaveLength(2);
  });
}
