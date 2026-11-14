import { expect, it } from "vitest";
import { signOfflineMeetingIdentity } from "@/lib/offline-meeting-identity";
import { identifySavedRollCall } from "@/test/identified-offline-roll-call";
import { crewSnapshot, snapshot } from "@/test/substrate-fixtures/lib/offline-manifests-fixtures";
import {
  latestOfflineCrewRollCall,
  latestOfflineRollCall,
  type OfflineRollCallEvent,
} from "./offline-manifests";

type Role = "diver" | "crew";
function scenario(
  role: Role,
  missingDay = 0,
  missingCheckpoint: "after_dive_1" | "after_dive_2" = "after_dive_1",
) {
  const copy = role === "crew" ? crewSnapshot() : snapshot();
  const tripId = "11111111-1111-4111-8111-111111111111";
  copy.snapshotId = "22222222-2222-4222-8222-222222222222";
  copy.rollCallMeetingDays = [0, 1, 2].map((day) => {
    const startsAt = new Date(Date.UTC(2026, 6, 20 + day, 12));
    const endsAt = new Date(Date.UTC(2026, 6, 20 + day, 16));
    return {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      meetingIdentityProof: signOfflineMeetingIdentity({
        shopId: "33333333-3333-4333-8333-333333333333",
        tripId,
        snapshotId: copy.snapshotId,
        meetingId: `44444444-4444-4444-8444-${String(day + 1).padStart(12, "0")}`,
        meetingDay: day,
        scheduleGeneration: 0,
        datasetIncarnation: "55555555-5555-4555-8555-555555555555",
        startsAt,
        endsAt,
      }),
    };
  });
  for (const manifest of copy.manifests) manifest.trip.id = tripId;
  copy.rollCallDayBoundaries = ["2026-07-21T00:00Z", "2026-07-22T00:00Z"];
  copy.selectedRollCallMeetingDay = 1;
  const subject = role === "crew" ? { crewPersonId: "crew-dana" } : { bookingId: "ready" };
  const rowAt = (checkpoint: "departure" | "after_dive_1" | "after_dive_2") => {
    const manifest = copy.manifests.find((item) => item.checkpoint === checkpoint);
    const row =
      role === "crew"
        ? manifest?.crew.find((item) => item.id === "crew-dana")
        : manifest?.divers.find((item) => item.bookingId === "ready");
    if (!row) throw new Error("fixture subject missing");
    return row;
  };
  const saved = (
    checkpoint: "departure" | "after_dive_1" | "after_dive_2",
    state: "boarded" | "not_boarded",
    day: number,
    identified = true,
  ) => {
    const row = rowAt(checkpoint);
    row.rollCall = { state, occurredAt: copy.savedAt, recordedByName: "Crew" };
    if (identified) {
      identifySavedRollCall(copy, subject, checkpoint, day);
      if (row.rollCallContext) row.rollCallContext.unknownMeetingDay = day < 0;
    }
    return row;
  };
  saved(missingCheckpoint, "not_boarded", missingDay);
  const tap = (
    checkpoint: OfflineRollCallEvent["checkpoint"],
    status: OfflineRollCallEvent["status"],
    day: number,
  ): OfflineRollCallEvent => ({
    ...subject,
    clientEventId: crypto.randomUUID(),
    tripId,
    snapshotId: copy.snapshotId,
    snapshotSavedAt: copy.savedAt,
    checkpoint,
    status,
    meetingDay: day,
    meetingIdentityProof: copy.rollCallMeetingDays?.[day]?.meetingIdentityProof,
    observedEvidenceIds: [],
    occurredAt: "1990-01-01T00:00Z",
    syncStatus: "pending",
  });
  const read = (events: OfflineRollCallEvent[] = []) =>
    role === "crew"
      ? latestOfflineCrewRollCall(copy, events, "crew-dana", missingCheckpoint)
      : latestOfflineRollCall(copy, events, "ready", missingCheckpoint);
  return { copy, rowAt, saved, tap, read };
}

for (const role of ["diver", "crew"] as const) {
  it(`settles known carried ${role} missing with a known intervening-day dock return independently of clocks`, () => {
    const { copy, tap, read } = scenario(role);
    copy.selectedRollCallMeetingDay = 2;
    expect(read([tap("departure", "boarded", 1)])).toBeUndefined();
  });

  it(`does not use conflicting later-dive ${role} positive evidence as a return`, () => {
    const { saved, tap, read } = scenario(role);
    saved("after_dive_2", "boarded", 0);
    expect(read([tap("after_dive_2", "not_boarded", 0)])).toMatchObject({ state: "not_boarded" });
  });

  it(`does not use a withdrawn later-dive ${role} positive statement as a return`, () => {
    const { saved, tap, read } = scenario(role);
    saved("after_dive_2", "boarded", 0);
    expect(read([tap("after_dive_2", "cleared", 0)])).toMatchObject({ state: "not_boarded" });
  });

  it(`keeps unknown-day ${role} missing despite a qualified known return`, () => {
    const { tap, read } = scenario(role, -1);
    expect(read([tap("departure", "boarded", 1)])).toMatchObject({ state: "not_boarded" });
  });

  it(`does not let an unidentified legacy ${role} positive settle known missing`, () => {
    const { saved, read } = scenario(role);
    saved("after_dive_2", "boarded", 0, false);
    expect(read()).toMatchObject({ state: "not_boarded" });
  });

  it(`does not assign a missing evidence-day to an identified ${role} positive`, () => {
    const { saved, read } = scenario(role);
    const row = saved("after_dive_2", "boarded", 0);
    if (!row.rollCallContext) throw new Error("fixture context missing");
    delete row.rollCallContext.evidence[0].meetingDay;
    expect(read()).toMatchObject({ state: "not_boarded" });
  });

  it(`does not settle conflicted earlier ${role} missing with another checkpoint's return`, () => {
    const { saved, tap, read } = scenario(role);
    saved("after_dive_2", "boarded", 0);
    expect(read([tap("after_dive_1", "boarded", 0)])).toMatchObject({ state: "not_boarded" });
  });

  it(`does not settle ${role} missing after dive two with a later day's earlier dive`, () => {
    const { tap, read } = scenario(role, 0, "after_dive_2");
    expect(read([tap("after_dive_1", "boarded", 1)])).toMatchObject({ state: "not_boarded" });
  });

  it(`does not use a ${role} return from a meeting day beyond the explicit selection`, () => {
    const { tap, read } = scenario(role);
    expect(read([tap("departure", "boarded", 2)])).toMatchObject({ state: "not_boarded" });
  });
}
