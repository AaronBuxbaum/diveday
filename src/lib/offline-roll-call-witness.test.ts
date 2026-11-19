import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  offlineRollCallWitnessEnabled,
  signRollCallWitness,
  verifyRollCallWitness,
} from "./offline-roll-call-witness";

describe("offline roll-call witness", () => {
  it("cannot activate the experimental path in production", () => {
    vi.stubEnv("DIVEDAY_OFFLINE_ROLL_CALL_WITNESS", "1");
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(offlineRollCallWitnessEnabled()).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("authenticates the snapshot, subject, meeting, assignment and causal frontier", () => {
    const claim = {
      shopId: randomUUID(),
      tripId: randomUUID(),
      snapshotId: randomUUID(),
      subjectKind: "seat" as const,
      subjectId: randomUUID(),
      checkpoint: "after_dive_1",
      meetingDay: 0,
      meetingGeneration: 3,
      assignmentGeneration: 2,
      frontier: [`server:${randomUUID()}`, `client:${randomUUID()}`],
    };
    const token = signRollCallWitness(claim);
    expect(verifyRollCallWitness(token, claim)).toEqual({
      meetingGeneration: 3,
      assignmentGeneration: 2,
      frontier: [...claim.frontier].sort(),
    });
    expect(verifyRollCallWitness(token, { ...claim, subjectId: randomUUID() })).toBeNull();
    expect(verifyRollCallWitness(token, { ...claim, tripId: randomUUID() })).toBeNull();
    expect(verifyRollCallWitness(token, { ...claim, snapshotId: randomUUID() })).toBeNull();
    expect(verifyRollCallWitness(token, { ...claim, checkpoint: "departure" })).toBeNull();
    expect(verifyRollCallWitness(token, { ...claim, meetingDay: 1 })).toBeNull();
    expect(verifyRollCallWitness(`${token}x`, claim)).toBeNull();
  });

  it("refuses unknown meeting days, malformed tokens and invalid generations", () => {
    const scope = {
      shopId: randomUUID(),
      tripId: randomUUID(),
      snapshotId: randomUUID(),
      subjectKind: "seat" as const,
      subjectId: randomUUID(),
      checkpoint: "departure",
      meetingDay: 0,
    };
    expect(verifyRollCallWitness("junk", scope)).toBeNull();
    expect(() =>
      signRollCallWitness({
        ...scope,
        meetingDay: -1,
        meetingGeneration: 1,
        assignmentGeneration: 1,
        frontier: [],
      }),
    ).toThrow();
    expect(() =>
      signRollCallWitness({
        ...scope,
        meetingGeneration: -1,
        assignmentGeneration: 1,
        frontier: [],
      }),
    ).toThrow();
  });
});
