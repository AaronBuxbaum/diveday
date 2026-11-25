import { describe, expect, it } from "vitest";
import type {
  IncidentCrewEntry,
  IncidentRollCallResult,
  IncidentRosterEntry,
  IncidentWaiverStatus,
} from "@/lib/incident-export";
import type { RollCallCheckpoint } from "@/lib/roll-call";
import { type HowItWentInput, howItWent } from "./rules";

// A Saturday in Key Largo: the shop's date runs 04:00Z to 04:00Z the next day.
const DAY = { from: new Date("2026-11-28T05:00:00Z"), to: new Date("2026-11-29T05:00:00Z") };
const CHECKPOINTS: RollCallCheckpoint[] = ["departure", "after_dive_1", "after_dive_2"];

function waiver(signedAt: string | null, extra: Partial<IncidentWaiverStatus> = {}) {
  return {
    state: signedAt ? "complete" : "awaiting_signature",
    signedAt,
    templateTitle: "Release",
    templateVersion: 1,
    signatureMethod: signedAt ? "typed_consent" : null,
    recordedByName: null,
    medicalClearedAt: null,
    medicalClearedByName: null,
    medicalClearanceDeclinedAt: null,
    medicalClearanceDeclinedByName: null,
    medicalClearanceEvaluatedOn: null,
    medicalClearancePhysicianName: null,
    medicalClearanceDocumentOnFile: false,
    ...extra,
  } as IncidentWaiverStatus;
}

function result(
  checkpoint: RollCallCheckpoint,
  label: IncidentRollCallResult["label"],
  occurredAt: string | null = null,
  by = "Sam",
): IncidentRollCallResult {
  return { checkpoint, label, occurredAt, recordedByName: occurredAt ? by : null };
}

function diver(name: string, overrides: Partial<IncidentRosterEntry> = {}): IncidentRosterEntry {
  return {
    bookingId: `b-${name}`,
    fullName: name,
    emergencyContactName: null,
    emergencyContactPhone: null,
    buddy: null,
    rollCall: CHECKPOINTS.map((checkpoint) => result(checkpoint, "awaiting")),
    certifications: [],
    certificationsStartedAt: null,
    certificationsCapturedAt: null,
    certificationsAtCapture: null,
    waiver: waiver("2026-11-20T15:00:00Z"),
    ...overrides,
  };
}

function crew(name: string, rollCall: IncidentRollCallResult[]): IncidentCrewEntry {
  return { fullName: name, roles: ["captain"], currentRatings: [], rollCall, buddyTeamNumbers: [] };
}

function input(overrides: Partial<HowItWentInput> = {}): HowItWentInput {
  return {
    checkpoints: CHECKPOINTS,
    roster: [],
    crew: [],
    turnedAway: [],
    executedDives: [],
    countedAboardBlocked: new Map(),
    fitStatedAt: new Map(),
    day: DAY,
    ...overrides,
  };
}

describe("howItWent: waivers", () => {
  it("splits signed ahead from signed on the day, and names paper releases", () => {
    const recap = howItWent(
      input({
        roster: [
          diver("Ana"),
          diver("Ben", { waiver: waiver("2026-11-28T12:40:00Z") }),
          diver("Cat", {
            waiver: waiver("2026-11-28T12:10:00Z", { signatureMethod: "in_person_attested" }),
          }),
          diver("Dev", { waiver: waiver(null) }),
        ],
      }),
    );
    expect(recap.waivers.ahead).toBe(1);
    expect(recap.waivers.onTheDay).toEqual([
      { name: "Cat", at: "2026-11-28T12:10:00Z", paper: true },
      { name: "Ben", at: "2026-11-28T12:40:00Z", paper: false },
    ]);
    expect(recap.waivers.notSigned).toEqual(["Dev"]);
  });

  it("never states a held seat's waiver, which would be the matched person's", () => {
    const recap = howItWent(
      input({ roster: [diver("Held", { identityWithheld: true, waiver: null })] }),
    );
    expect(recap.waivers).toEqual({ ahead: 0, onTheDay: [], notSigned: [] });
  });

  it("does not call a waiver signed after the departure's date ahead", () => {
    const recap = howItWent(
      input({ roster: [diver("Late", { waiver: waiver("2026-11-30T12:00:00Z") })] }),
    );
    expect(recap.waivers.ahead).toBe(0);
    expect(recap.waivers.notSigned).toEqual(["Late"]);
  });
});

describe("howItWent: sorted before boarding", () => {
  const boardedAt = "2026-11-28T13:00:00Z";
  const boarded = CHECKPOINTS.map((checkpoint) =>
    checkpoint === "departure"
      ? result(checkpoint, "boarded", boardedAt)
      : result(checkpoint, "awaiting"),
  );

  it("lists what was done that morning, no later than the dock mark", () => {
    const recap = howItWent(
      input({
        roster: [
          diver("Eli", {
            rollCall: boarded,
            waiver: waiver("2026-11-28T12:30:00Z"),
            certifications: [
              {
                kind: "level",
                agency: "padi",
                level: "open_water",
                specialty: null,
                identifier: null,
                status: "verified",
                reviewedAt: "2026-11-28T12:45:00Z",
                reviewedByName: "Sam",
                imported: false,
                selfDeclared: false,
              },
            ],
          }),
        ],
        fitStatedAt: new Map([["b-Eli", new Date("2026-11-28T12:50:00Z")]]),
      }),
    );
    expect(recap.sorted).toEqual([
      {
        name: "Eli",
        fixes: [
          { kind: "waiver", at: "2026-11-28T12:30:00Z" },
          { kind: "card", at: "2026-11-28T12:45:00Z" },
          { kind: "rentalFit", at: "2026-11-28T12:50:00.000Z" },
        ],
      },
    ]);
  });

  it("leaves out anything done after the diver was counted aboard", () => {
    const recap = howItWent(
      input({
        roster: [diver("Fay", { rollCall: boarded, waiver: waiver("2026-11-28T13:05:00Z") })],
        fitStatedAt: new Map([["b-Fay", new Date("2026-11-28T13:30:00Z")]]),
      }),
    );
    expect(recap.sorted).toEqual([]);
  });

  it("says nothing was sorted before boarding for a diver no dock count put aboard", () => {
    const recap = howItWent(
      input({ roster: [diver("Gus", { waiver: waiver("2026-11-28T12:30:00Z") })] }),
    );
    expect(recap.sorted).toEqual([]);
  });

  it("does not count an unverified card as checked", () => {
    const recap = howItWent(
      input({
        roster: [
          diver("Hal", {
            rollCall: boarded,
            certifications: [
              {
                kind: "level",
                agency: "padi",
                level: "open_water",
                specialty: null,
                identifier: null,
                status: "pending",
                reviewedAt: "2026-11-28T12:45:00Z",
                reviewedByName: null,
                imported: false,
                selfDeclared: true,
              },
            ],
          }),
        ],
      }),
    );
    expect(recap.sorted).toEqual([]);
  });

  it("names turned-away seats and seats counted aboard while blocked", () => {
    const recap = howItWent(
      input({
        roster: [diver("Ivy", { rollCall: boarded })],
        turnedAway: [{ bookingId: "b-Jo", fullName: "Jo", reason: "medical" }],
        countedAboardBlocked: new Map([
          ["b-Ivy", { checkpoint: "departure", blockers: [{ code: "waiver_not_sent" }] }],
        ]),
      }),
    );
    expect(recap.turnedAway).toEqual([{ name: "Jo", reason: "medical" }]);
    expect(recap.aboardWithOpenItems).toEqual([
      { name: "Ivy", checkpoint: "departure", blockers: [{ code: "waiver_not_sent" }] },
    ]);
  });
});

describe("howItWent: head counts", () => {
  it("reads each count off its own results, crew included", () => {
    const recap = howItWent(
      input({
        roster: [
          diver("Kim", {
            rollCall: [
              result("departure", "boarded", "2026-11-28T13:00:00Z"),
              result("after_dive_1", "boarded", "2026-11-28T14:40:00Z"),
              result("after_dive_2", "awaiting"),
            ],
          }),
          diver("Lee", {
            rollCall: [
              result("departure", "not_boarded", "2026-11-28T13:01:00Z"),
              result("after_dive_1", "not_boarded_carried"),
              result("after_dive_2", "not_boarded_carried"),
            ],
          }),
        ],
        crew: [
          crew("Cap", [
            result("departure", "boarded", "2026-11-28T13:02:00Z", "Rae"),
            result("after_dive_1", "boarded", "2026-11-28T14:41:00Z", "Rae"),
            result("after_dive_2", "awaiting"),
          ]),
        ],
        executedDives: [{ diveNumber: 1, actualSiteName: "Molasses Reef" }],
      }),
    );
    expect(recap.counts[0]).toMatchObject({
      dive: 0,
      taken: true,
      aboard: 2,
      crewAboard: 1,
      notRecorded: [],
      at: "2026-11-28T13:02:00Z",
      by: "Rae",
    });
    expect(recap.counts[1]).toMatchObject({
      dive: 1,
      site: "Molasses Reef",
      taken: true,
      aboard: 2,
      at: "2026-11-28T14:41:00Z",
    });
    // Nobody counted after dive 2: never read as everyone back.
    expect(recap.counts[2]).toMatchObject({ dive: 2, taken: false, aboard: 0, at: null });
  });

  it("names who a count left unrecorded and who it recorded not back", () => {
    const recap = howItWent(
      input({
        roster: [
          diver("Max", {
            rollCall: [
              result("departure", "boarded", "2026-11-28T13:00:00Z"),
              result("after_dive_1", "boarded", "2026-11-28T14:40:00Z"),
              result("after_dive_2", "awaiting"),
            ],
          }),
          diver("Ned", {
            rollCall: [
              result("departure", "boarded", "2026-11-28T13:00:00Z"),
              result("after_dive_1", "not_back_aboard", "2026-11-28T14:42:00Z"),
              result("after_dive_2", "awaiting"),
            ],
          }),
          diver("Oz", {
            rollCall: [
              result("departure", "boarded", "2026-11-28T13:00:00Z"),
              result("after_dive_1", "awaiting"),
              result("after_dive_2", "awaiting"),
            ],
          }),
        ],
      }),
    );
    expect(recap.counts[1]).toMatchObject({ aboard: 1, notBack: ["Ned"], notRecorded: ["Oz"] });
  });
});
