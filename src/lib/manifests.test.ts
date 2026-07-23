import { describe, expect, it } from "vitest";
import {
  buildTripManifest,
  carryForwardNotBoarded,
  isRollCallCheckpoint,
  maxRecordedDiveNumber,
  type RollCallRecord,
  rollCallCheckpointLabel,
  rollCallCheckpoints,
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
      crew: [{ fullName: "Dana Reyes", roles: ["captain"] }],
      divers: [
        {
          bookingId: "booking-ready",
          fullName: "Priya Sharma",
          email: "priya@example.com",
          emergencyContactName: "Asha Sharma",
          emergencyContactPhone: "+1-305-555-0101",
          readiness: { status: "ready", blockers: [] },
          rentalFit: { state: "rents" as const, text: "BCD M, Wetsuit 5mm M" },
          nitroxRequested: true,
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
          rentalFit: { state: "not_recorded" as const, text: "No fit on file — not asked yet" },
          nitroxRequested: false,
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
    expect(rollCallCheckpointLabel("after_dive_2")).toBe("After dive 2");
  });

  it("finds the highest recorded dive number, or 0 with no after-dive history", () => {
    expect(maxRecordedDiveNumber([])).toBe(0);
    expect(maxRecordedDiveNumber(["departure"])).toBe(0);
    expect(maxRecordedDiveNumber(["departure", "after_dive_1"])).toBe(1);
    expect(maxRecordedDiveNumber(["after_dive_1", "after_dive_3", "after_dive_2"])).toBe(3);
    expect(maxRecordedDiveNumber(["not-a-checkpoint", "after_dive_4"])).toBe(4);
  });
});
