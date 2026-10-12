import { describe, expect, it } from "vitest";
import {
  lapsedCredentialKinds,
  type SafetyDepartureInput,
  type SafetyMonthInput,
  type SafetyRollCallEvent,
  summarizeSafetyMonth,
} from "./safety-report";

const departure: SafetyDepartureInput = {
  tripId: "t1",
  title: "Morning two-tank",
  startsAt: new Date("2026-10-03T13:00:00Z"),
  endsAt: new Date("2026-10-03T17:00:00Z"),
  plannedDives: 2,
  bookingIds: ["b1", "b2"],
  crewIds: ["c1"],
};

function diver(
  subjectId: string,
  checkpoint: string,
  status: SafetyRollCallEvent["status"] = "boarded",
): SafetyRollCallEvent {
  return { tripId: "t1", subjectId, checkpoint, status };
}

function month(overrides: Partial<SafetyMonthInput> = {}): SafetyMonthInput {
  return {
    timeZone: "America/New_York",
    departures: [departure],
    diverEvents: [],
    crewEvents: [],
    credentials: [],
    personNames: new Map([["c1", "Keiko Tanaka"]]),
    certOverrides: 0,
    ...overrides,
  };
}

const everyoneBack = [
  diver("b1", "departure"),
  diver("b2", "departure"),
  diver("b1", "after_dive_1"),
  diver("b2", "after_dive_1"),
  diver("b1", "after_dive_2"),
  diver("b2", "after_dive_2"),
];

describe("summarizeSafetyMonth: roll calls", () => {
  it("counts a departure whose every count closed", () => {
    const summary = summarizeSafetyMonth(month({ diverEvents: everyoneBack }));
    expect(summary.rollCallsClosed).toBe(1);
    expect(summary.openRollCalls).toEqual([]);
    expect(summary.boardedAtDock).toBe(2);
    expect(summary.unmarkedAtDock).toBe(0);
  });

  it("never reads a departure with no roll call as closed", () => {
    const summary = summarizeSafetyMonth(month());
    expect(summary.rollCallsClosed).toBe(0);
    expect(summary.openRollCalls).toMatchObject([{ tripId: "t1", closure: "none" }]);
    expect(summary.unmarkedAtDock).toBe(2);
  });

  it("keeps a count open when a diver is recorded not back aboard", () => {
    const events = [...everyoneBack, diver("b2", "after_dive_2", "not_boarded")];
    expect(summarizeSafetyMonth(month({ diverEvents: events })).openRollCalls).toMatchObject([
      { closure: "open" },
    ]);
  });

  it("treats an undone mark as no mark", () => {
    const events = [...everyoneBack, diver("b1", "after_dive_1", "cleared")];
    expect(summarizeSafetyMonth(month({ diverEvents: events })).rollCallsClosed).toBe(0);
  });

  it("does not wait for a diver left ashore at the dock to come back", () => {
    const events = [
      diver("b1", "departure"),
      diver("b2", "departure", "not_boarded"),
      diver("b1", "after_dive_1"),
      diver("b1", "after_dive_2"),
    ];
    const summary = summarizeSafetyMonth(month({ diverEvents: events }));
    expect(summary.rollCallsClosed).toBe(1);
    expect(summary.boardedAtDock).toBe(1);
  });

  it("holds the count open for a crew member who boarded and was never counted back", () => {
    const crewEvents = [
      { tripId: "t1", subjectId: "c1", checkpoint: "departure", status: "boarded" as const },
    ];
    expect(
      summarizeSafetyMonth(month({ diverEvents: everyoneBack, crewEvents })).rollCallsClosed,
    ).toBe(0);
  });
});

describe("summarizeSafetyMonth: crew credentials", () => {
  it("names a crew member who sailed on a credential lapsed by the day of the dive", () => {
    const summary = summarizeSafetyMonth(
      month({
        credentials: [
          { personId: "c1", kind: "first_aid_cpr", renewsAt: "2026-10-02" },
          { personId: "c1", kind: "divemaster_rating", renewsAt: "2027-01-01" },
        ],
      }),
    );
    expect(summary.crewSailings).toBe(1);
    expect(summary.lapsedSailings).toEqual([
      expect.objectContaining({ personId: "c1", name: "Keiko Tanaka", kinds: ["first_aid_cpr"] }),
    ]);
  });

  it("does not count a crew member recorded ashore at the dock as sailing", () => {
    const summary = summarizeSafetyMonth(
      month({
        crewEvents: [
          { tripId: "t1", subjectId: "c1", checkpoint: "departure", status: "not_boarded" },
        ],
        credentials: [{ personId: "c1", kind: "first_aid_cpr", renewsAt: "2020-01-01" }],
      }),
    );
    expect(summary.crewSailings).toBe(0);
    expect(summary.lapsedSailings).toEqual([]);
  });
});

describe("lapsedCredentialKinds", () => {
  it("is good through the renewal day itself", () => {
    expect(
      lapsedCredentialKinds(
        [{ personId: "p", kind: "oxygen_provider", renewsAt: "2026-10-03" }],
        "2026-10-03",
      ),
    ).toEqual([]);
  });

  it("takes one current record of a kind as enough, and an undated one as saying nothing", () => {
    expect(
      lapsedCredentialKinds(
        [
          { personId: "p", kind: "instructor_rating", renewsAt: "2025-01-01" },
          { personId: "p", kind: "instructor_rating", renewsAt: "2027-01-01" },
          { personId: "p", kind: "liability_insurance", renewsAt: null },
        ],
        "2026-10-03",
      ),
    ).toEqual([]);
  });
});
