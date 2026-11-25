import { describe, expect, it } from "vitest";
import type {
  IncidentCrewEntry,
  IncidentRollCallResult,
  IncidentRosterEntry,
  IncidentWaiverStatus,
} from "@/lib/incident-export";
import type { RollCallCheckpoint } from "@/lib/roll-call";
import { type HowItWentInput, howItWent, seatsTurnedAway } from "./rules";

// A Saturday in Key Largo in November (EST): the shop's date runs 05:00Z to 05:00Z.
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
    timeline: [],
    countedAboardBlocked: new Map(),
    unsettled: new Map(),
    fitStatedAt: new Map(),
    span: DAY,
    ...overrides,
  };
}

const BOARDED_AT = "2026-11-28T13:00:00Z";
const boardedAtDock = CHECKPOINTS.map((checkpoint) =>
  checkpoint === "departure"
    ? result(checkpoint, "boarded", BOARDED_AT)
    : result(checkpoint, "awaiting"),
);
const card = (status: string, reviewedAt: string) => ({
  kind: "level" as const,
  agency: "padi",
  level: "open_water",
  specialty: null,
  identifier: null,
  status,
  reviewedAt,
  reviewedByName: "Sam",
  imported: false,
  selfDeclared: false,
});

describe("howItWent: waivers", () => {
  it("splits ahead, on the day, after, and names paper releases", () => {
    const recap = howItWent(
      input({
        roster: [
          diver("Ana"),
          diver("Ben", { waiver: waiver("2026-11-28T12:40:00Z") }),
          diver("Cat", {
            waiver: waiver("2026-11-28T12:10:00Z", { signatureMethod: "in_person_attested" }),
          }),
          diver("Dev", { waiver: waiver(null) }),
          diver("Eve", { waiver: waiver("2026-11-30T12:00:00Z") }),
        ],
      }),
    );
    expect(recap.waivers.ahead).toBe(1);
    expect(recap.waivers.during).toEqual([
      { name: "Cat", at: "2026-11-28T12:10:00Z", paper: true },
      { name: "Ben", at: "2026-11-28T12:40:00Z", paper: false },
    ]);
    // A waiver signed after the departure is a fact of its own, never "not signed".
    expect(recap.waivers.after).toEqual([{ name: "Eve", at: "2026-11-30T12:00:00Z" }]);
    expect(recap.waivers.notSigned).toEqual(["Dev"]);
  });

  it("counts a second day's signature as during a two-day departure", () => {
    const recap = howItWent(
      input({
        span: { from: DAY.from, to: new Date("2026-11-30T05:00:00Z") },
        roster: [diver("Ana", { waiver: waiver("2026-11-29T12:10:00Z") })],
      }),
    );
    expect(recap.waivers.during.map((row) => row.name)).toEqual(["Ana"]);
    expect(recap.waivers.notSigned).toEqual([]);
  });

  it("says a doctor's hold in its own words, never as no waiver", () => {
    const recap = howItWent(
      input({
        roster: [
          diver("Ben", {
            waiver: waiver("2026-11-20T15:00:00Z", { state: "medical_not_cleared" }),
          }),
          diver("Cy", { waiver: waiver("2026-11-20T15:00:00Z", { state: "medical_review" }) }),
        ],
      }),
    );
    expect(recap.waivers.doctorDeclined).toEqual(["Ben"]);
    expect(recap.waivers.doctorPending).toEqual(["Cy"]);
    expect(recap.waivers.notSigned).toEqual([]);
  });

  it("never states a held seat's waiver, and counts it as held", () => {
    const recap = howItWent(
      input({ roster: [diver("Held", { identityWithheld: true, waiver: null })] }),
    );
    expect(recap.waivers).toMatchObject({ ahead: 0, during: [], notSigned: [], held: 1 });
  });
});

describe("howItWent: sorted before boarding", () => {
  it("lists what was done that morning, no later than the dock mark", () => {
    const recap = howItWent(
      input({
        roster: [
          diver("Eli", {
            rollCall: boardedAtDock,
            waiver: waiver("2026-11-28T12:30:00Z"),
            certifications: [card("verified", "2026-11-28T12:45:00Z")],
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

  it("reads the cards as captured at boarding, not as they stand now", () => {
    const recap = howItWent(
      input({
        roster: [
          diver("Ike", {
            rollCall: boardedAtDock,
            certifications: [card("verified", "2026-12-02T09:00:00Z")],
            certificationsAtCapture: [card("verified", "2026-11-28T12:45:00Z")],
          }),
        ],
      }),
    );
    expect(recap.sorted).toEqual([
      { name: "Ike", fixes: [{ kind: "card", at: "2026-11-28T12:45:00Z" }] },
    ]);
  });

  it("leaves out anything done after the diver was counted aboard", () => {
    const recap = howItWent(
      input({
        roster: [diver("Fay", { rollCall: boardedAtDock, waiver: waiver("2026-11-28T13:05:00Z") })],
        fitStatedAt: new Map([["b-Fay", new Date("2026-11-28T13:30:00Z")]]),
      }),
    );
    expect(recap.sorted).toEqual([]);
  });

  it("says it is not known when no dock count was taken", () => {
    const recap = howItWent(
      input({ roster: [diver("Gus", { waiver: waiver("2026-11-28T12:30:00Z") })] }),
    );
    expect(recap.sorted).toBeNull();
  });

  it("does not count an unverified card as checked", () => {
    const recap = howItWent(
      input({
        roster: [
          diver("Hal", {
            rollCall: boardedAtDock,
            certifications: [card("pending", "2026-11-28T12:45:00Z")],
          }),
        ],
      }),
    );
    expect(recap.sorted).toEqual([]);
  });

  it("names turned-away seats and seats boarded while blocked, with where", () => {
    const recap = howItWent(
      input({
        roster: [diver("Ivy", { rollCall: boardedAtDock })],
        turnedAway: [{ bookingId: "b-Jo", fullName: "Jo", reason: "medical" }],
        countedAboardBlocked: new Map([
          ["b-Ivy", { checkpoint: "departure", blockers: [{ code: "waiver_not_sent" }] }],
        ]),
      }),
    );
    expect(recap.turnedAway).toEqual([{ name: "Jo", reason: "medical" }]);
    expect(recap.boardedBlocked).toEqual([
      { name: "Ivy", dive: 0, blockers: [{ code: "waiver_not_sent" }] },
    ]);
  });
});

describe("howItWent: head counts", () => {
  it("reads each count off its own results, divers and crew apart", () => {
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
      divers: 1,
      crew: 1,
      ashore: ["Lee"],
      notRecorded: [],
      at: "2026-11-28T13:02:00Z",
      by: "Rae",
    });
    expect(recap.counts[1]).toMatchObject({
      dive: 1,
      site: "Molasses Reef",
      taken: true,
      divers: 1,
    });
    // Nobody counted after dive 2: never read as everyone back. Everyone
    // aboard before it is named as having no result there.
    expect(recap.counts[2]).toMatchObject({
      dive: 2,
      taken: false,
      divers: 0,
      at: null,
      notRecorded: ["Kim", "Cap"],
    });
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
    expect(recap.counts[1]).toMatchObject({ divers: 1, notBack: ["Ned"], notRecorded: ["Oz"] });
  });

  it("never counts a dock mark two devices disagree on as aboard", () => {
    const recap = howItWent(
      input({
        roster: [
          diver("Pat", { rollCall: boardedAtDock }),
          diver("Quin", { rollCall: boardedAtDock }),
        ],
        unsettled: new Map([["departure", new Set(["b-Quin"])]]),
      }),
    );
    expect(recap.counts[0]).toMatchObject({ divers: 1, unsettled: ["Quin"] });
    expect(recap.sorted?.map((row) => row.name) ?? []).not.toContain("Quin");
  });

  it("keeps a diver recorded not back and later found, with both times", () => {
    const recap = howItWent(
      input({
        roster: [
          diver("Ned", {
            rollCall: [
              result("departure", "boarded", "2026-11-28T13:00:00Z"),
              result("after_dive_1", "boarded", "2026-11-28T16:09:00Z"),
              result("after_dive_2", "awaiting"),
            ],
          }),
        ],
        timeline: [
          {
            kind: "diver",
            occurredAt: "2026-11-28T16:02:00Z",
            checkpoint: "after_dive_1",
            subjectName: "Ned",
            action: "not_boarded",
            source: "live",
            recordedByName: "Sam",
          },
          {
            kind: "diver",
            occurredAt: "2026-11-28T16:09:00Z",
            checkpoint: "after_dive_1",
            subjectName: "Ned",
            action: "boarded",
            source: "live",
            recordedByName: "Sam",
          },
        ],
      }),
    );
    expect(recap.counts[1]?.recovered).toEqual([
      { name: "Ned", notBackAt: "2026-11-28T16:02:00Z", backAt: "2026-11-28T16:09:00Z" },
    ]);
  });
});

describe("seatsTurnedAway", () => {
  const priya = { bookingId: "b-priya", fullName: "Priya Sharma" } as IncidentRosterEntry;
  const sam = { bookingId: "b-sam", fullName: "Sam Lee" } as IncidentRosterEntry;

  it("names a seat the desk turned away even after the boat recorded it", () => {
    expect(
      seatsTurnedAway(
        [],
        [priya, sam],
        [
          { bookingId: "b-priya", turnedAway: true, turnedAwayReason: "medical" },
          { bookingId: "b-sam", turnedAway: false, turnedAwayReason: null },
        ],
      ),
    ).toEqual([{ bookingId: "b-priya", fullName: "Priya Sharma", reason: "medical" }]);
  });

  it("names a seat once when the log already has it, and keeps an erased reason as unknown", () => {
    const logged = [{ bookingId: "b-sam", fullName: "Sam Lee", reason: null }];
    expect(
      seatsTurnedAway(
        logged,
        [priya, sam],
        [
          { bookingId: "b-sam", turnedAway: true, turnedAwayReason: "medical" },
          { bookingId: "b-priya", turnedAway: true, turnedAwayReason: null },
        ],
      ),
    ).toEqual([
      { bookingId: "b-sam", fullName: "Sam Lee", reason: null },
      { bookingId: "b-priya", fullName: "Priya Sharma", reason: null },
    ]);
  });

  it("names a seat the desk turned away and the crew then boarded, with the original reason", () => {
    const boarded = {
      ...priya,
      rollCall: [
        {
          checkpoint: "departure",
          label: "boarded",
          occurredAt: "2026-11-28T15:00:00Z",
          recordedByName: "Sam",
        },
      ],
    } as unknown as IncidentRosterEntry;
    const refused = new Map([
      ["b-priya", { reason: "card" as const, at: new Date("2026-11-28T14:00:00Z") }],
    ]);
    expect(
      seatsTurnedAway([], [boarded, sam], [{ bookingId: "b-priya", turnedAway: false }], refused),
    ).toEqual([
      { bookingId: "b-priya", fullName: "Priya Sharma", reason: "card", thenBoarded: true },
    ]);
    // Boarded before the refusal, not after: not listed.
    expect(
      seatsTurnedAway(
        [],
        [
          {
            ...boarded,
            rollCall: [
              {
                checkpoint: "departure",
                label: "boarded",
                occurredAt: "2026-11-28T13:00:00Z",
                recordedByName: "Sam",
              },
            ],
          } as unknown as IncidentRosterEntry,
        ],
        [],
        refused,
      ),
    ).toEqual([]);
    // Refused and then reinstated by the desk, never boarded: not listed.
    expect(
      seatsTurnedAway(
        [],
        [{ ...priya, rollCall: [] } as unknown as IncidentRosterEntry],
        [],
        refused,
      ),
    ).toEqual([]);
  });
});
