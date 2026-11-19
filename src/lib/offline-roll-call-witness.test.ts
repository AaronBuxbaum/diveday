import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  offlineRollCallWitnessEnabled,
  signRollCallWitness,
  verifyRollCallWitness,
} from "./offline-roll-call-witness";

describe("offline roll-call witness", () => {
  it("enables witness validation for a production database without a flag", () => {
    vi.stubEnv("DIVEDAY_OFFLINE_ROLL_CALL_WITNESS", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgres://real-configured");
    try {
      expect(offlineRollCallWitnessEnabled()).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("lets the database-free E2E harness opt in without disabling production", () => {
    vi.stubEnv("DIVEDAY_OFFLINE_ROLL_CALL_WITNESS", "1");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DIVEDAY_E2E", "1");
    vi.stubEnv("DATABASE_URL", "");
    try {
      expect(offlineRollCallWitnessEnabled()).toBe(true);
      vi.stubEnv("DATABASE_URL", "postgres://real-configured");
      expect(offlineRollCallWitnessEnabled()).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("enables witnesses in ordinary development without a flag", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DIVEDAY_E2E", "");
    vi.stubEnv("DIVEDAY_OFFLINE_ROLL_CALL_WITNESS", "");
    try {
      expect(offlineRollCallWitnessEnabled()).toBe(true);
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

  it("authenticates the represented person for later online review", () => {
    const claim = {
      shopId: randomUUID(),
      tripId: randomUUID(),
      snapshotId: randomUUID(),
      subjectKind: "seat" as const,
      subjectId: randomUUID(),
      checkpoint: "departure",
      meetingDay: 0,
      meetingGeneration: 0,
      assignmentGeneration: 0,
      frontier: [],
      originalPersonId: randomUUID(),
    };
    const token = signRollCallWitness(claim);
    expect(verifyRollCallWitness(token, claim)).toMatchObject({
      originalPersonId: claim.originalPersonId,
    });
    expect(verifyRollCallWitness(token, { ...claim, subjectId: randomUUID() })).toBeNull();
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
