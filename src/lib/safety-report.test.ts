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

  it("holds the count open for a crew member with no dock mark recorded not back aboard", () => {
    const crewEvents = [
      { tripId: "t1", subjectId: "c1", checkpoint: "after_dive_2", status: "not_boarded" as const },
    ];
    expect(
      summarizeSafetyMonth(month({ diverEvents: everyoneBack, crewEvents })).openRollCalls,
    ).toMatchObject([{ closure: "open" }]);
  });

  it("holds the count open for a crew member whose after-dive mark was undone", () => {
    const crewEvents = [
      { tripId: "t1", subjectId: "c1", checkpoint: "after_dive_1", status: "boarded" as const },
      { tripId: "t1", subjectId: "c1", checkpoint: "after_dive_2", status: "boarded" as const },
      { tripId: "t1", subjectId: "c1", checkpoint: "after_dive_2", status: "cleared" as const },
    ];
    expect(
      summarizeSafetyMonth(month({ diverEvents: everyoneBack, crewEvents })).rollCallsClosed,
    ).toBe(0);
  });

  it("reads a diver who joined at the second site as Today does: owed every after-dive count", () => {
    const joined = [
      diver("b1", "departure"),
      diver("b2", "departure", "not_boarded"),
      diver("b1", "after_dive_1"),
      diver("b1", "after_dive_2"),
      // b2 met the boat at the second site and was counted back after it.
      diver("b2", "after_dive_2"),
    ];
    // The shared population rule (src/lib/roll-call-population.ts) has no
    // "joined at" mark, so dive 1's count waits on b2 until somebody marks it.
    expect(summarizeSafetyMonth(month({ diverEvents: joined })).openRollCalls).toMatchObject([
      { closure: "open" },
    ]);
    const marked = [...joined, diver("b2", "after_dive_1")];
    expect(summarizeSafetyMonth(month({ diverEvents: marked })).rollCallsClosed).toBe(1);
  });

  it("keeps a count open for a diver left ashore with a stray after-dive result", () => {
    const stray = [
      diver("b1", "departure"),
      diver("b2", "departure", "not_boarded"),
      diver("b1", "after_dive_1"),
      diver("b1", "after_dive_2"),
      // A tap on the wrong row: b2 is now in the after-dive count, and is
      // not marked back aboard after dive 1.
      diver("b2", "after_dive_2", "not_boarded"),
    ];
    expect(summarizeSafetyMonth(month({ diverEvents: stray })).openRollCalls).toMatchObject([
      { closure: "open" },
    ]);
  });

  it("never lets one departure's marks close another that shares its seats or crew", () => {
    const second = { ...departure, tripId: "t2", title: "Afternoon two-tank" };
    const summary = summarizeSafetyMonth(
      month({
        departures: [departure, second],
        diverEvents: everyoneBack,
        crewEvents: [
          { tripId: "t1", subjectId: "c1", checkpoint: "departure", status: "boarded" },
          { tripId: "t1", subjectId: "c1", checkpoint: "after_dive_1", status: "boarded" },
          { tripId: "t1", subjectId: "c1", checkpoint: "after_dive_2", status: "boarded" },
        ],
      }),
    );
    expect(summary.rollCallsClosed).toBe(1);
    expect(summary.openRollCalls).toMatchObject([{ tripId: "t2", closure: "none" }]);
    expect(summary.boardedAtDock).toBe(2);
    expect(summary.crewSailings).toBe(2);
  });

  it("passes over a departure with nobody booked and no head count, as an empty occurrence", () => {
    const empty = { ...departure, tripId: "t3", bookingIds: [], crewIds: ["c1"] };
    const summary = summarizeSafetyMonth(
      month({ departures: [departure, empty], diverEvents: everyoneBack }),
    );
    expect(summary.departuresBack).toBe(1);
    expect(summary.openRollCalls).toEqual([]);
    expect(summary.crewSailings).toBe(1);
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

describe("summarizeSafetyMonth: crew with nothing on file", () => {
  it("never reads a crew member with no credential recorded as sailing clean", () => {
    const summary = summarizeSafetyMonth(month());
    expect(summary.crewSailings).toBe(1);
    expect(summary.lapsedSailings).toEqual([]);
    expect(summary.unrecordedSailings).toBe(1);
    expect(summary.unrecordedCrew).toEqual([{ personId: "c1", name: "Keiko Tanaka", sailings: 1 }]);
  });

  it("counts each sailing and names each person once, by name", () => {
    const second: SafetyDepartureInput = {
      ...departure,
      tripId: "t2",
      startsAt: new Date("2026-10-04T13:00:00Z"),
      endsAt: new Date("2026-10-04T17:00:00Z"),
      crewIds: ["c1", "c2"],
    };
    const summary = summarizeSafetyMonth(
      month({
        departures: [departure, second],
        credentials: [{ personId: "c2", kind: "captain_license", renewsAt: null }],
        personNames: new Map([
          ["c1", "Sal Moretti"],
          ["c2", "Keiko Tanaka"],
        ]),
      }),
    );
    expect(summary.crewSailings).toBe(3);
    expect(summary.unrecordedSailings).toBe(2);
    expect(summary.unrecordedCrew).toEqual([{ personId: "c1", name: "Sal Moretti", sailings: 2 }]);
    // The lapsed ratio stands over the sailings it judged, not over the two
    // it skipped for having nothing on file (layer 1 review, finding 2).
    expect(summary.checkedSailings).toBe(1);
  });

  it("does not count a crew member recorded ashore at the dock", () => {
    const summary = summarizeSafetyMonth(
      month({
        crewEvents: [
          { tripId: "t1", subjectId: "c1", checkpoint: "departure", status: "not_boarded" },
        ],
      }),
    );
    expect(summary.unrecordedSailings).toBe(0);
    expect(summary.unrecordedCrew).toEqual([]);
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
