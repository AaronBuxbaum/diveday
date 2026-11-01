import { describe, expect, it } from "vitest";
import {
  lapsedCredentialKinds,
  type SafetyCrewMember,
  type SafetyDepartureInput,
  type SafetyMonthInput,
  type SafetyRollCallEvent,
  summarizeSafetyMonth,
  summarizeSafetyYear,
} from "./safety-report";

/** A crew member with no named job and no standing role: any credential answers. */
function member(
  personId: string,
  tripRole: SafetyCrewMember["tripRole"] = null,
  shopRoles: readonly string[] = [],
): SafetyCrewMember {
  return { personId, tripRole, shopRoles };
}

const departure: SafetyDepartureInput = {
  tripId: "t1",
  title: "Morning two-tank",
  startsAt: new Date("2026-10-03T13:00:00Z"),
  endsAt: new Date("2026-10-03T17:00:00Z"),
  plannedDives: 2,
  diveMode: "boat",
  bookingIds: ["b1", "b2"],
  crew: [member("c1")],
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
    const empty = { ...departure, tripId: "t3", bookingIds: [], crew: [member("c1")] };
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
      crew: [member("c1"), member("c2")],
    };
    const summary = summarizeSafetyMonth(
      month({
        departures: [departure, second],
        credentials: [{ personId: "c2", kind: "captains_licence", renewsAt: null }],
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

/**
 * **"No credential on file" is role-matched** (issue #2548). A captain with only
 * a first-aid card has nothing that says he may captain; an instructor with
 * only liability insurance has no rating. A report, never a gate (H-20260825-staff-credentials-renewal-clock).
 */
describe("summarizeSafetyMonth: a credential that answers the job", () => {
  const sailedAs = (
    tripRole: SafetyCrewMember["tripRole"],
    shopRoles: readonly string[],
    kinds: readonly string[],
  ) =>
    summarizeSafetyMonth(
      month({
        departures: [{ ...departure, crew: [member("c1", tripRole, shopRoles)] }],
        credentials: kinds.map((kind) => ({ personId: "c1", kind, renewsAt: null })),
      }),
    );

  it("counts a captain with only first aid as unrecorded, though a card is on file", () => {
    const summary = sailedAs("captain", ["captain"], ["first_aid_cpr"]);
    expect(summary.unrecordedSailings).toBe(1);
    expect(summary.unrecordedCrew).toEqual([{ personId: "c1", name: "Keiko Tanaka", sailings: 1 }]);
    // The first-aid card is still on file to be judged for a lapse.
    expect(summary.checkedSailings).toBe(1);
  });

  it("counts an instructor with only liability insurance as unrecorded", () => {
    expect(sailedAs("instructor", ["instructor"], ["liability_insurance"]).unrecordedSailings).toBe(
      1,
    );
  });

  it("does not count a divemaster who holds an instructor rating", () => {
    expect(sailedAs("divemaster", ["divemaster"], ["instructor_rating"]).unrecordedSailings).toBe(
      0,
    );
  });

  it("counts a divemaster with a divemaster rating, and an assistant instructor with theirs", () => {
    expect(sailedAs("divemaster", [], ["divemaster_rating"]).unrecordedSailings).toBe(0);
    expect(
      sailedAs(null, ["assistant_instructor"], ["assistant_instructor_rating"]).unrecordedSailings,
    ).toBe(0);
  });

  it("never lets a lower rating answer a higher job", () => {
    expect(sailedAs("instructor", [], ["divemaster_rating"]).unrecordedSailings).toBe(1);
    expect(sailedAs("instructor", [], ["assistant_instructor_rating"]).unrecordedSailings).toBe(1);
  });

  it("answers a captain only with a captain's license, never an instructor rating", () => {
    expect(sailedAs("captain", [], ["instructor_rating"]).unrecordedSailings).toBe(1);
    expect(sailedAs("captain", [], ["captains_licence"]).unrecordedSailings).toBe(0);
  });

  it("never reads a free-text 'other' credential as a rating", () => {
    expect(sailedAs("instructor", [], ["other"]).unrecordedSailings).toBe(1);
    expect(sailedAs("captain", [], ["other"]).unrecordedSailings).toBe(1);
  });

  it("measures the job rostered for the trip, not the standing role", () => {
    // A divemaster rostered as captain sailed as captain.
    expect(sailedAs("captain", ["divemaster"], ["divemaster_rating"]).unrecordedSailings).toBe(1);
    // An instructor rostered as plain crew needs no rating; a card of any kind answers.
    expect(sailedAs("crew", ["instructor"], ["first_aid_cpr"]).unrecordedSailings).toBe(0);
  });

  it("falls back to the standing roles when the roster names no job, and to any card for none", () => {
    expect(sailedAs(null, ["captain"], ["first_aid_cpr"]).unrecordedSailings).toBe(1);
    expect(
      sailedAs(null, ["captain", "divemaster"], ["divemaster_rating"]).unrecordedSailings,
    ).toBe(0);
    expect(sailedAs(null, [], ["first_aid_cpr"]).unrecordedSailings).toBe(0);
  });

  it("still reads nothing on file as unrecorded for a job no card answers", () => {
    const summary = sailedAs("crew", [], []);
    expect(summary.unrecordedSailings).toBe(1);
    expect(summary.checkedSailings).toBe(0);
  });

  it("still judges a lapse on the cards a role-less captain has", () => {
    const summary = summarizeSafetyMonth(
      month({
        departures: [{ ...departure, crew: [member("c1", "captain", ["captain"])] }],
        credentials: [{ personId: "c1", kind: "first_aid_cpr", renewsAt: "2026-10-02" }],
      }),
    );
    expect(summary.unrecordedSailings).toBe(1);
    expect(summary.lapsedSailings).toEqual([
      expect.objectContaining({ personId: "c1", kinds: ["first_aid_cpr"] }),
    ]);
  });
});

describe("summarizeSafetyMonth: a credential issued after the sailing (review F3)", () => {
  it("keeps a sailing on an expired card lapsed after a renewal is added as a new record", () => {
    // Sailed 2026-10-03 on a card that ran out 2026-10-02; the renewal was
    // entered on 2026-10-20 as a second record of the same kind.
    const summary = summarizeSafetyMonth(
      month({
        diverEvents: everyoneBack,
        credentials: [
          { personId: "c1", kind: "first_aid_cpr", issuedAt: "2024-10-02", renewsAt: "2026-10-02" },
          { personId: "c1", kind: "first_aid_cpr", issuedAt: "2026-10-20", renewsAt: "2028-10-20" },
        ],
      }),
    );
    expect(summary.lapsedSailings.map((row) => row.kinds)).toEqual([["first_aid_cpr"]]);
  });

  it("never lets a license issued after the sailing answer for it", () => {
    const summary = summarizeSafetyMonth(
      month({
        departures: [{ ...departure, crew: [member("c1", "captain")] }],
        diverEvents: everyoneBack,
        credentials: [
          { personId: "c1", kind: "captains_licence", issuedAt: "2026-11-01", renewsAt: null },
        ],
      }),
    );
    expect(summary.unrecordedSailings).toBe(1);
    expect(summary.checkedSailings).toBe(0);
  });

  it("counts a credential issued on the day of the sailing, or with no issue date", () => {
    const summary = summarizeSafetyMonth(
      month({
        departures: [{ ...departure, crew: [member("c1", "captain")] }],
        diverEvents: everyoneBack,
        credentials: [
          { personId: "c1", kind: "captains_licence", issuedAt: "2026-10-03", renewsAt: null },
          { personId: "c1", kind: "first_aid_cpr", renewsAt: null },
        ],
      }),
    );
    expect(summary.unrecordedSailings).toBe(0);
    expect(summary.checkedSailings).toBe(1);
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

describe("summarizeSafetyMonth: departures with no crew on record (fourth review, item 13)", () => {
  // A second boat whose crew sailed, so the month has crew on record and the
  // list is the answer (a month with none is one quiet line, below).
  const crewedBoat = { ...departure, tripId: "t2", bookingIds: ["b3"] };
  const crewedBack = [...everyoneBack, diver("b3", "departure"), diver("b3", "return")];

  it("lists a departure that sailed with nobody on the crew, instead of reading 0 of 0", () => {
    const summary = summarizeSafetyMonth(
      month({
        departures: [{ ...departure, crew: [] }, crewedBoat],
        diverEvents: crewedBack,
      }),
    );
    expect(summary.crewSailings).toBe(1);
    expect(summary.noCrewOnRecord).toBe(false);
    expect(summary.noCrewDepartures).toEqual([
      { tripId: "t1", title: "Morning two-tank", startsAt: departure.startsAt },
    ]);
  });

  it("counts a crew recorded ashore at the dock as no crew aboard", () => {
    const summary = summarizeSafetyMonth(
      month({
        departures: [departure, crewedBoat],
        diverEvents: crewedBack,
        crewEvents: [
          { tripId: "t1", subjectId: "c1", checkpoint: "departure", status: "not_boarded" },
        ],
      }),
    );
    expect(summary.noCrewDepartures.map((row) => row.tripId)).toEqual(["t1"]);
  });

  it("never says a shore dive or a pool session sailed (review F1)", () => {
    const summary = summarizeSafetyMonth(
      month({
        departures: [
          { ...departure, tripId: "shore", diveMode: "shore", crew: [] },
          { ...departure, tripId: "pool", diveMode: "pool", crew: [] },
          crewedBoat,
        ],
        diverEvents: [
          diver("b1", "departure"),
          diver("b2", "departure"),
          diver("b3", "departure"),
        ].flatMap((event) => [
          { ...event, tripId: "shore" },
          { ...event, tripId: "pool" },
          { ...event, tripId: "t2" },
        ]),
      }),
    );
    expect(summary.noCrewDepartures).toEqual([]);
  });

  it("states a month with no crew recorded anywhere once, instead of listing every boat (review F1)", () => {
    // A shop that never rosters crew was never asked: listing all its boats
    // as sailing with nobody would be the report shouting at it.
    const summary = summarizeSafetyMonth(
      month({
        departures: [
          { ...departure, crew: [] },
          { ...crewedBoat, crew: [] },
        ],
        diverEvents: crewedBack,
      }),
    );
    expect(summary.crewSailings).toBe(0);
    expect(summary.noCrewOnRecord).toBe(true);
    expect(summary.noCrewDepartures).toEqual([]);
  });

  it("lists the boats of a month whose rostered crew were all ashore, not the quiet line (N7)", () => {
    const summary = summarizeSafetyMonth(
      month({
        departures: [departure],
        diverEvents: everyoneBack,
        crewEvents: [
          { tripId: "t1", subjectId: "c1", checkpoint: "departure", status: "not_boarded" },
        ],
      }),
    );
    expect(summary.crewSailings).toBe(0);
    expect(summary.noCrewOnRecord).toBe(false);
    expect(summary.noCrewDepartures.map((row) => row.tripId)).toEqual(["t1"]);
  });

  it("says nothing of a departure whose crew sailed, on file or not", () => {
    const summary = summarizeSafetyMonth(month({ diverEvents: everyoneBack }));
    expect(summary.crewSailings).toBe(1);
    expect(summary.noCrewDepartures).toEqual([]);
  });

  it("passes over an empty occurrence nobody booked or counted", () => {
    const summary = summarizeSafetyMonth(
      month({ departures: [{ ...departure, bookingIds: [], crew: [] }] }),
    );
    expect(summary.noCrewDepartures).toEqual([]);
    // Nothing came back, so there is no month of crew to speak of either.
    expect(summary.noCrewOnRecord).toBe(false);
  });
});

describe("summarizeSafetyYear (dive-domain review F1)", () => {
  const crewedBoat = { ...departure, tripId: "t2", bookingIds: ["b3"] };
  const crewedBack = [...everyoneBack, diver("b3", "departure"), diver("b3", "return")];
  // Before the shop rostered crew: two boats back, nobody on either list.
  const unrostered = summarizeSafetyMonth(
    month({
      departures: [
        { ...departure, crew: [] },
        { ...crewedBoat, crew: [] },
      ],
      diverEvents: crewedBack,
    }),
  );
  // After: one boat crewed, one not.
  const rostered = summarizeSafetyMonth(
    month({ departures: [{ ...departure, crew: [] }, crewedBoat], diverEvents: crewedBack }),
  );
  const quiet = summarizeSafetyMonth(month({ departures: [] }));

  it("sums each month as that month reads it, so a month with no crew rostered adds no boats", () => {
    const year = summarizeSafetyYear([unrostered, unrostered, quiet, rostered]);
    expect(year.noCrewDepartures.map((row) => row.tripId)).toEqual(["t1"]);
    expect(year.noCrewOnRecord).toBe(false);
    expect(year.monthsBack).toBe(3);
    expect(year.monthsWithoutCrew).toBe(2);
    expect(year.departuresBack).toBe(6);
    // Only the rostered month's boats were judged (chain-r5 review F1).
    expect(year.boatsBack).toBe(2);
    expect(year.crewSailings).toBe(rostered.crewSailings);
    expect(year.rollCallsClosed).toBe(unrostered.rollCallsClosed * 2 + rostered.rollCallsClosed);
  });

  it("is one quiet line when no month had crew on record", () => {
    const year = summarizeSafetyYear([unrostered, quiet]);
    expect(year.noCrewOnRecord).toBe(true);
    expect(year.monthsWithoutCrew).toBe(1);
    expect(year.noCrewDepartures).toEqual([]);
  });

  it("names each crew member without a credential once, summing their sailings", () => {
    const unrecorded = summarizeSafetyMonth(month({ diverEvents: everyoneBack }));
    expect(unrecorded.unrecordedCrew).toEqual([
      { personId: "c1", name: "Keiko Tanaka", sailings: 1 },
    ]);
    expect(summarizeSafetyYear([unrecorded, unrecorded]).unrecordedCrew).toEqual([
      { personId: "c1", name: "Keiko Tanaka", sailings: 2 },
    ]);
  });
});

describe("summarizeSafetyMonth: boats back (dive-domain review N5)", () => {
  it("counts only boat departures as the no-crew figure's denominator", () => {
    const summary = summarizeSafetyMonth(
      month({
        departures: [departure, { ...departure, tripId: "shore", diveMode: "shore" }],
        diverEvents: [...everyoneBack, { ...diver("b1", "departure"), tripId: "shore" }],
      }),
    );
    expect(summary.departuresBack).toBe(2);
    expect(summary.boatsBack).toBe(1);
  });
});
