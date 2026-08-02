import { describe, expect, it } from "vitest";
import {
  buildTripManifest,
  type CrewAttestation,
  carryForwardNotBoarded,
  isRollCallCheckpoint,
  maxRecordedDiveNumber,
  type RollCallRecord,
  rollCallCheckpoints,
  rollCallCompleteness,
  rollCallLabel,
} from "./manifests";

const boardedAt = (recordedByName = "Dana Reyes"): RollCallRecord => ({
  state: "boarded",
  occurredAt: new Date("2026-07-20T11:45:00.000Z"),
  recordedByName,
  note: null,
});
const notBoardedAt = (note: string | null = null): RollCallRecord => ({
  state: "not_boarded",
  occurredAt: new Date("2026-07-20T11:45:00.000Z"),
  recordedByName: "Dana Reyes",
  note,
});

const trip = {
  id: "trip-1",
  title: "Two-Tank Reef",
  startsAt: new Date("2026-07-20T12:00:00.000Z"),
  endsAt: new Date("2026-07-20T16:00:00.000Z"),
  plannedDives: 2,
};

describe("buildTripManifest", () => {
  it("retains every supplied booking and fails closed when its readiness lookup is unavailable", () => {
    const manifest = buildTripManifest({
      trip,
      crew: [{ id: "crew-dana", fullName: "Dana Reyes", roles: ["captain"] }],
      divers: [
        {
          bookingId: "booking-ready",
          fullName: "Priya Sharma",
          email: "priya@example.com",
          emergencyContactName: "Asha Sharma",
          emergencyContactPhone: "+1-305-555-0101",
          readiness: { status: "ready", blockers: [] },
          rentalFit: {
            state: "rents" as const,
            items: [
              { kind: "bcd" as const, size: "M" },
              { kind: "wetsuit" as const, size: "5mm M" },
            ],
          },
          nitroxRequested: true,
          checkedIn: true,
          rollCall: {
            state: "boarded",
            occurredAt: new Date("2026-07-20T11:45:00.000Z"),
            recordedByName: "Dana Reyes",
            note: null,
          },
        },
        {
          bookingId: "booking-unknown",
          fullName: "Omar Haddad",
          email: null,
          emergencyContactName: null,
          emergencyContactPhone: null,
          rentalFit: { state: "not_recorded" as const },
          nitroxRequested: false,
          checkedIn: false,
        },
      ],
    });

    expect(manifest.divers).toHaveLength(2);
    expect(manifest.divers[1]?.readiness.blockers).toContainEqual(
      expect.objectContaining({ code: "readiness_unavailable" }),
    );
    expect(manifest.summary).toEqual({
      totalDivers: 2,
      ready: 1,
      blocked: 1,
      boarded: 1,
      notBoarded: 0,
      awaiting: 1,
    });
    // Counter check-in and boat roll call are different questions (task 149):
    // a diver can be checked in at the counter without being boarded, or
    // vice versa on a walk-in who skipped the counter — the manifest carries
    // both independently rather than conflating them.
    expect(manifest.divers.find((d) => d.bookingId === "booking-ready")?.checkedIn).toBe(true);
    expect(manifest.divers.find((d) => d.bookingId === "booking-unknown")?.checkedIn).toBe(false);
  });

  it("uses explicit words for every roll-call state", () => {
    expect(rollCallLabel(undefined)).toBe("Awaiting roll call");
    expect(rollCallLabel(notBoardedAt("Stayed ashore"))).toBe("Not boarded");
    expect(rollCallLabel(boardedAt())).toBe("Boarded");
    expect(rollCallLabel({ ...notBoardedAt(), implied: true })).toBe("Not boarded · carried");
  });

  it("carries a not-boarded result forward until a later result breaks the chain", () => {
    // Not boarded at departure → every later checkpoint defaults to not boarded.
    const carried = carryForwardNotBoarded([notBoardedAt("Left the boat"), undefined, undefined]);
    expect(carried[0]).toMatchObject({ state: "not_boarded", note: "Left the boat" });
    expect(carried[0]?.implied).toBeUndefined();
    expect(carried[1]).toMatchObject({ state: "not_boarded", implied: true });
    expect(carried[2]).toMatchObject({ state: "not_boarded", implied: true });
  });

  it("does not carry a boarded result forward, and an explicit later result wins", () => {
    // Boarded is checkpoint-specific: the next list starts awaiting again.
    expect(carryForwardNotBoarded([boardedAt(), undefined])).toEqual([boardedAt(), undefined]);
    // A re-board after leaving stops the carry-forward from that point.
    const reboarded = carryForwardNotBoarded([notBoardedAt(), boardedAt(), undefined]);
    expect(reboarded[1]).toMatchObject({ state: "boarded" });
    expect(reboarded[2]).toBeUndefined();
    // An explicit result at a later checkpoint is never overwritten by the default.
    const explicitLater = carryForwardNotBoarded([notBoardedAt(), notBoardedAt("Own decision")]);
    expect(explicitLater[1]).toMatchObject({ note: "Own decision" });
    expect(explicitLater[1]?.implied).toBeUndefined();
  });

  it("builds bounded departure and after-dive checkpoints", () => {
    expect(rollCallCheckpoints(2)).toEqual(["departure", "after_dive_1", "after_dive_2"]);
    expect(isRollCallCheckpoint("after_dive_2", 2)).toBe(true);
    expect(isRollCallCheckpoint("after_dive_3", 2)).toBe(false);
    // A checkpoint's word ("Before departure" / "After dive N") is resolved
    // against a message bundle by the caller — see
    // src/i18n/manifest-labels.test.ts's `rollCallCheckpointText` coverage —
    // `RollCallCheckpoint` itself is already the code.
  });

  it("finds the highest recorded dive number, or 0 with no after-dive history", () => {
    const t0 = new Date("2026-06-01T10:00:00Z");
    const boarded = (bookingId: string, checkpoint: string, occurredAt = t0) => ({
      bookingId,
      checkpoint,
      status: "boarded",
      occurredAt,
      createdAt: occurredAt,
    });

    expect(maxRecordedDiveNumber([])).toBe(0);
    expect(maxRecordedDiveNumber([boarded("b1", "departure")])).toBe(0);
    expect(maxRecordedDiveNumber([boarded("b1", "departure"), boarded("b1", "after_dive_1")])).toBe(
      1,
    );
    expect(
      maxRecordedDiveNumber([
        boarded("b1", "after_dive_1"),
        boarded("b2", "after_dive_3"),
        boarded("b1", "after_dive_2"),
      ]),
    ).toBe(3);
    expect(
      maxRecordedDiveNumber([boarded("b1", "not-a-checkpoint"), boarded("b1", "after_dive_4")]),
    ).toBe(4);
  });

  it("ignores a checkpoint whose latest event for that diver is a clear — the mis-tap-then-undo case (dive-domain-expert review finding, CR-006)", () => {
    const t0 = new Date("2026-06-01T10:00:00Z");
    const t1 = new Date("2026-06-01T10:05:00Z");

    // b1 was mis-tapped at after_dive_3, then immediately cleared — no diver
    // was ever actually counted there, so it must not block a plannedDives
    // edit down to 2.
    expect(
      maxRecordedDiveNumber([
        {
          bookingId: "b1",
          checkpoint: "after_dive_3",
          status: "boarded",
          occurredAt: t0,
          createdAt: t0,
        },
        {
          bookingId: "b1",
          checkpoint: "after_dive_3",
          status: "cleared",
          occurredAt: t1,
          createdAt: t1,
        },
        {
          bookingId: "b1",
          checkpoint: "after_dive_2",
          status: "boarded",
          occurredAt: t0,
          createdAt: t0,
        },
      ]),
    ).toBe(2);

    // But a second diver genuinely boarded at after_dive_3 (never cleared)
    // means dive 3 really did happen — the checkpoint counts.
    expect(
      maxRecordedDiveNumber([
        {
          bookingId: "b1",
          checkpoint: "after_dive_3",
          status: "boarded",
          occurredAt: t0,
          createdAt: t0,
        },
        {
          bookingId: "b1",
          checkpoint: "after_dive_3",
          status: "cleared",
          occurredAt: t1,
          createdAt: t1,
        },
        {
          bookingId: "b2",
          checkpoint: "after_dive_3",
          status: "boarded",
          occurredAt: t0,
          createdAt: t0,
        },
      ]),
    ).toBe(3);
  });
});

/**
 * DOM-H1. Crew are the people most reliably in the water and were not part of
 * the head count at all — a checkpoint with every booked diver counted read
 * "roll call complete" with a divemaster still down. These are the rules that
 * stop it, and this is the *only* definition of complete: both the live
 * manifest and the offline copy consume this one function.
 */
describe("rollCallCompleteness — the crew half of the head count (DOM-H1)", () => {
  const attested = (crewAboard: number, crewAssigned = crewAboard): CrewAttestation => ({
    crewAboard,
    crewAssigned,
    attestedByName: "Dana Reyes",
    occurredAt: new Date("2026-07-20T11:45:00.000Z"),
    note: null,
  });

  it("does not read complete when every diver is counted but no crew attestation exists", () => {
    // The bug, stated as a test: divers all done, checkpoint still open.
    expect(
      rollCallCompleteness({ totalDivers: 6, awaiting: 0, crewAssigned: 2, crewAttestation: null }),
    ).toEqual({
      complete: false,
      diversAccountedFor: true,
      crewAccountedFor: false,
      reason: "crew_not_attested",
    });
  });

  it("does not read complete when fewer crew are attested aboard than are assigned", () => {
    expect(
      rollCallCompleteness({
        totalDivers: 6,
        awaiting: 0,
        crewAssigned: 3,
        crewAttestation: attested(2, 3),
      }),
    ).toMatchObject({ complete: false, crewAccountedFor: false, reason: "crew_short" });
  });

  it("reads complete only once divers and crew are both accounted for", () => {
    expect(
      rollCallCompleteness({
        totalDivers: 6,
        awaiting: 0,
        crewAssigned: 2,
        crewAttestation: attested(2),
      }),
    ).toEqual({
      complete: true,
      diversAccountedFor: true,
      crewAccountedFor: true,
      reason: null,
    });
  });

  it("keeps the diver rules first: an awaiting diver outranks any crew count", () => {
    expect(
      rollCallCompleteness({
        totalDivers: 6,
        awaiting: 1,
        crewAssigned: 2,
        crewAttestation: attested(2),
      }),
    ).toMatchObject({ complete: false, diversAccountedFor: false, reason: "divers_awaiting" });
    // An empty roster never read complete before this change either.
    expect(
      rollCallCompleteness({ totalDivers: 0, awaiting: 0, crewAssigned: 2, crewAttestation: null }),
    ).toMatchObject({ complete: false, reason: "no_divers" });
  });

  it("treats a trip with zero assigned crew as still needing a human to say “0 of 0”", () => {
    // The tempting shortcut — "no crew assigned, so nothing to count" — would
    // hand back a silent pass on exactly the trips whose crew data is worst,
    // since an empty assignment list is a scheduling gap rather than evidence
    // that nobody else was aboard.
    expect(
      rollCallCompleteness({ totalDivers: 4, awaiting: 0, crewAssigned: 0, crewAttestation: null }),
    ).toMatchObject({ complete: false, crewAccountedFor: false, reason: "crew_not_attested" });
    // Said out loud by a named human, it closes.
    expect(
      rollCallCompleteness({
        totalDivers: 4,
        awaiting: 0,
        crewAssigned: 0,
        crewAttestation: attested(0),
      }),
    ).toMatchObject({ complete: true, crewAccountedFor: true, reason: null });
  });

  it("compares against the crew assigned now, not the denominator stored on the attestation", () => {
    // A divemaster added after the count was taken re-opens the checkpoint
    // rather than riding on a stale "2 of 2".
    expect(
      rollCallCompleteness({
        totalDivers: 4,
        awaiting: 0,
        crewAssigned: 3,
        crewAttestation: attested(2, 2),
      }),
    ).toMatchObject({ complete: false, reason: "crew_short" });
  });

  it("accepts more crew aboard than assigned — an extra hand is accounted for, not missing", () => {
    expect(
      rollCallCompleteness({
        totalDivers: 4,
        awaiting: 0,
        crewAssigned: 2,
        crewAttestation: attested(3, 2),
      }),
    ).toMatchObject({ complete: true, reason: null });
  });

  it("is the definition buildTripManifest derives, so no surface can invent its own", () => {
    const withCrew = (crewAttestation: CrewAttestation | null) =>
      buildTripManifest({
        trip,
        crew: [{ id: "crew-1", fullName: "Dana Reyes", roles: ["captain"] }],
        crewAttestation,
        divers: [
          {
            bookingId: "booking-1",
            fullName: "Priya Sharma",
            email: null,
            emergencyContactName: null,
            emergencyContactPhone: null,
            readiness: { status: "ready", blockers: [] },
            rentalFit: { state: "own_kit" as const },
            nitroxRequested: false,
            checkedIn: true,
            rollCall: boardedAt(),
          },
        ],
      });

    // Every diver boarded — the old inline rule (`totalDivers > 0 && awaiting
    // === 0`, written twice at the UI layer) called this complete.
    const unattested = withCrew(null);
    expect(unattested.summary.awaiting).toBe(0);
    expect(unattested.completeness).toMatchObject({
      complete: false,
      reason: "crew_not_attested",
    });
    expect(withCrew(attested(1)).completeness.complete).toBe(true);
  });
});
