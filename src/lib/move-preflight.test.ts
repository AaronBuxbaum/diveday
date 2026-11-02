import { describe, expect, it } from "vitest";
import {
  composeMovePreflight,
  DEFAULT_MIN_TURNAROUND_MINUTES,
  type MovePreflightFacts,
  parseMinTurnaroundMinutes,
  turnaroundGapMinutes,
} from "./move-preflight";

/** A departure nothing has happened to: on the board, empty, untouched. */
const quiet: MovePreflightFacts = {
  toldSeats: 0,
  gearReserved: 0,
  paidOrders: 0,
  cancellationWindowHours: null,
  rollCallEvidence: 0,
  scheduled: true,
  boatClashes: [],
  crewClashes: [],
  crewAway: [],
  turnarounds: [],
};

describe("composeMovePreflight", () => {
  /**
   * The restraint case, and the one worth pinning hardest: a departure with no
   * consequences composes to *nothing*, so the panel renders nothing rather
   * than four headings with zeroes under them.
   */
  it("says nothing at all about an untouched departure", () => {
    expect(composeMovePreflight(quiet)).toEqual({ blocked: null, sections: [] });
  });

  it("reports only the sections that have something in them", () => {
    expect(composeMovePreflight({ ...quiet, gearReserved: 3 }).sections).toEqual([
      { kind: "gear", count: 3 },
    ]);
  });

  /**
   * The head count is not a consequence — the board row above the panel already
   * shows it. What the board cannot show is that four of those divers have
   * already been sent the date, which is the only part that makes work.
   */
  it("speaks about divers only once somebody has been told the date", () => {
    expect(composeMovePreflight(quiet).sections).toEqual([]);
    expect(composeMovePreflight({ ...quiet, toldSeats: 4 }).sections).toEqual([
      { kind: "told", reminded: 4 },
    ]);
  });

  it("orders the sections boat, crew, people, kit, money", () => {
    const full = composeMovePreflight({
      toldSeats: 4,
      gearReserved: 3,
      paidOrders: 5,
      cancellationWindowHours: 48,
      rollCallEvidence: 0,
      scheduled: true,
      boatClashes: [{ boat: "Mantis I", departure: "Night Dive" }],
      crewClashes: [{ name: "Marcus Webb", departure: "Night Dive" }],
      crewAway: [],
      turnarounds: [],
    });
    expect(full.sections.map((section) => section.kind)).toEqual([
      "boat",
      "crew",
      "told",
      "gear",
      "money",
    ]);
    expect(full.sections.at(-1)).toEqual({
      kind: "money",
      paid: 5,
      cancellationWindowHours: 48,
    });
  });

  /**
   * The window is a term the departure has always carried, not something the
   * move does. It rides along with money that actually moved and is never a
   * section of its own.
   */
  it("does not print a cancellation window with no money behind it", () => {
    expect(composeMovePreflight({ ...quiet, cancellationWindowHours: 48 }).sections).toEqual([]);
    expect(
      composeMovePreflight({ ...quiet, paidOrders: 2, cancellationWindowHours: 48 }).sections,
    ).toEqual([{ kind: "money", paid: 2, cancellationWindowHours: 48 }]);
  });

  /**
   * An unpaid invoice is unaffected by a move — the date changes, the amount
   * owed does not — so it is deliberately not a fact this reads. Pinned because
   * "count the open ones too" is the obvious next change, and it would put a
   * number on the panel with no consequence attached to it.
   */
  it("says nothing about money that has not moved", () => {
    expect(composeMovePreflight({ ...quiet, paidOrders: 0 }).sections).toEqual([]);
  });

  describe("the refusals it mirrors", () => {
    it("says a departure with any roll-call evidence will be refused", () => {
      expect(composeMovePreflight({ ...quiet, rollCallEvidence: 1 }).blocked).toBe(
        "already_sailed",
      );
    });

    it("says a canceled departure will be refused", () => {
      expect(composeMovePreflight({ ...quiet, scheduled: false }).blocked).toBe("not_scheduled");
    });

    /**
     * `moveTrip` checks status *before* evidence, so a cancelled trip that also
     * carries a roll call is refused as `not_scheduled` there. A preview that
     * named the other reason would be telling staff to fix the wrong thing.
     */
    it("names the refusal the mutation would actually give, when both hold", () => {
      expect(
        composeMovePreflight({ ...quiet, scheduled: false, rollCallEvidence: 3 }).blocked,
      ).toBe("not_scheduled");
    });

    /**
     * A blocked move still has facts behind it, and they are the reason the
     * refusal is worth reading — the roll call is against *these* six divers.
     */
    it("keeps reporting the consequences of a departure it says cannot move", () => {
      const blocked = composeMovePreflight({ ...quiet, toldSeats: 6, rollCallEvidence: 4 });
      expect(blocked.blocked).toBe("already_sailed");
      expect(blocked.sections).toEqual([{ kind: "told", reminded: 6 }]);
    });
  });

  /**
   * **The two crew lines, the only ones that depend on where the boat is
   * going** (issue #1310).
   *
   * Both directions matter, and the silent one matters more. A departure whose
   * crew are free at the time it is going to must produce no crew section at
   * all — the panel's rule is that a section with nothing to report is not
   * rendered, and a heading reading "nobody clashes" would be the furniture
   * this whole preview exists not to build.
   */
  it("says nothing about crew when nobody is double-booked and nobody is away", () => {
    expect(composeMovePreflight({ ...quiet, crewClashes: [], crewAway: [] }).sections).toEqual([]);
  });

  it("names each clash with the departure it collides with, never a count", () => {
    // Names, never a count: "2 crew are rostered" was measured at 24 of the
    // demo board's 25 departures and removed, and the row the panel opens
    // under already prints the crew. What it cannot print is that those people
    // are already on a boat at that hour — nor which boat.
    expect(
      composeMovePreflight({
        ...quiet,
        crewClashes: [
          { name: "Marcus Webb", departure: "Night Dive" },
          { name: "Talia Okonkwo", departure: "Two-Tank Reef" },
        ],
      }).sections,
    ).toEqual([
      {
        kind: "crew",
        clashes: [
          { name: "Marcus Webb", departure: "Night Dive" },
          { name: "Talia Okonkwo", departure: "Two-Tank Reef" },
        ],
      },
    ]);
  });

  /**
   * The blackout is its own section because it is a different kind of fact:
   * the crew member's own statement rather than an inference from the roster,
   * and something the owner may knowingly override rather than a physical
   * impossibility. Collapsing the two would make one sentence do two jobs and
   * lose which one the reader is looking at.
   */
  it("keeps the blackout separate from the clash, and beneath it", () => {
    const both = composeMovePreflight({
      ...quiet,
      crewClashes: [{ name: "Marcus Webb", departure: "Night Dive" }],
      crewAway: ["Talia Okonkwo"],
    });
    expect(both.sections.map((section) => section.kind)).toEqual(["crew", "crewAway"]);
    expect(both.sections.at(-1)).toEqual({ kind: "crewAway", names: ["Talia Okonkwo"] });
  });

  it("reports a blackout on its own, with no clash to lead it", () => {
    // The case the first version of this feature was silent on: nobody is
    // double-booked, and the shop has still written down that they are away.
    expect(composeMovePreflight({ ...quiet, crewAway: ["Talia Okonkwo"] }).sections).toEqual([
      { kind: "crewAway", names: ["Talia Okonkwo"] },
    ]);
  });

  it("still reports the clash on a departure the move would be refused for", () => {
    // Same rule the other sections already follow: a blocked departure keeps
    // its facts, because they are the reason the refusal is worth reading.
    const blocked = composeMovePreflight({
      ...quiet,
      rollCallEvidence: 1,
      crewClashes: [{ name: "Marcus Webb", departure: "Night Dive" }],
    });
    expect(blocked.blocked).toBe("already_sailed");
    expect(blocked.sections).toEqual([
      { kind: "crew", clashes: [{ name: "Marcus Webb", departure: "Night Dive" }] },
    ]);
  });

  /**
   * **One hull, one departure at a time** (H-20260916-may-one-hull-carry, issue #1780). A move that
   * lands the boat on top of another departure on the same hull is said before
   * it happens, above the crew: a hull double-booked is the bigger fact, and
   * fixing it usually moves the crew question with it.
   */
  it("names the departure the hull would be on at the same time, first", () => {
    const both = composeMovePreflight({
      ...quiet,
      boatClashes: [{ boat: "Mantis I", departure: "Night Dive" }],
      crewClashes: [{ name: "Marcus Webb", departure: "Night Dive" }],
    });
    expect(both.sections).toEqual([
      { kind: "boat", clashes: [{ boat: "Mantis I", departure: "Night Dive" }] },
      { kind: "crew", clashes: [{ name: "Marcus Webb", departure: "Night Dive" }] },
    ]);
  });

  it("reports a boat clash on a departure the move would be refused for", () => {
    const blocked = composeMovePreflight({
      ...quiet,
      scheduled: false,
      boatClashes: [{ boat: "Mantis I", departure: "Night Dive" }],
    });
    expect(blocked.blocked).toBe("not_scheduled");
    expect(blocked.sections).toEqual([
      { kind: "boat", clashes: [{ boat: "Mantis I", departure: "Night Dive" }] },
    ]);
  });
});

/**
 * **A tight turnaround is information, never a clash** (issue #2141, Aaron's
 * decision (b)). H-20260916-may-one-hull-carry's half-open overlap stands: nose to tail is the plan and
 * says nothing as a clash. This is the near miss beside it — one line, under
 * any clash, never a refusal.
 */
describe("turnaroundGapMinutes", () => {
  const at = (iso: string) => new Date(iso);
  const window = (start: string, end: string) => ({ startsAt: at(start), endsAt: at(end) });
  const moved = [window("2030-08-05T08:00:00Z", "2030-08-05T12:00:00Z")];

  it("is quiet exactly at the gap", () => {
    expect(
      turnaroundGapMinutes(moved, [window("2030-08-05T12:30:00Z", "2030-08-05T16:00:00Z")], 30),
    ).toBeNull();
  });

  it("speaks one minute under the gap, naming the minutes", () => {
    expect(
      turnaroundGapMinutes(moved, [window("2030-08-05T12:29:00Z", "2030-08-05T16:00:00Z")], 30),
    ).toBe(29);
  });

  it("speaks at either end: a departure due back just before this one leaves", () => {
    expect(
      turnaroundGapMinutes(moved, [window("2030-08-05T04:00:00Z", "2030-08-05T07:50:00Z")], 30),
    ).toBe(10);
  });

  it("speaks for nose to tail, which H-20260916-may-one-hull-carry keeps quiet as a clash", () => {
    expect(
      turnaroundGapMinutes(moved, [window("2030-08-05T12:00:00Z", "2030-08-05T16:00:00Z")], 30),
    ).toBe(0);
  });

  it("leaves an overlap to the clash line", () => {
    expect(
      turnaroundGapMinutes(moved, [window("2030-08-05T11:00:00Z", "2030-08-05T15:00:00Z")], 30),
    ).toBeNull();
  });

  it("reads every leg of a multi-day departure and reports the tightest gap", () => {
    const course = [
      window("2030-08-05T08:00:00Z", "2030-08-05T12:00:00Z"),
      window("2030-08-06T08:00:00Z", "2030-08-06T12:00:00Z"),
    ];
    expect(
      turnaroundGapMinutes(
        course,
        [
          window("2030-08-05T12:20:00Z", "2030-08-05T16:00:00Z"),
          window("2030-08-06T12:05:00Z", "2030-08-06T16:00:00Z"),
        ],
        30,
      ),
    ).toBe(5);
  });

  it("is quiet when the shop sets no gap", () => {
    expect(
      turnaroundGapMinutes(moved, [window("2030-08-05T12:00:00Z", "2030-08-05T16:00:00Z")], 0),
    ).toBeNull();
  });

  it("defaults to thirty minutes", () => {
    expect(DEFAULT_MIN_TURNAROUND_MINUTES).toBe(30);
  });
});

describe("composeMovePreflight's turnaround line", () => {
  const boat = {
    kind: "boat",
    name: "Mantis I",
    departure: "Afternoon Reef",
    minutes: 10,
  } as const;
  const crew = { kind: "crew", name: "Marcus Webb", departure: "Night Dive", minutes: 20 } as const;

  it("says nothing when no departure is close", () => {
    expect(composeMovePreflight({ ...quiet, turnarounds: [] }).sections).toEqual([]);
  });

  it("sits under every clash line and above the costs of going ahead", () => {
    const composed = composeMovePreflight({
      ...quiet,
      toldSeats: 2,
      boatClashes: [{ boat: "Mantis I", departure: "Night Dive" }],
      crewClashes: [{ name: "Ana Ruiz", departure: "Night Dive" }],
      crewAway: ["Ana Ruiz"],
      turnarounds: [boat, crew],
    });
    expect(composed.sections.map((section) => section.kind)).toEqual([
      "boat",
      "crew",
      "crewAway",
      "turnaround",
      "told",
    ]);
    expect(composed.sections[3]).toEqual({ kind: "turnaround", items: [boat, crew] });
  });

  it("never blocks the move", () => {
    expect(composeMovePreflight({ ...quiet, turnarounds: [boat] }).blocked).toBeNull();
  });
});

describe("parseMinTurnaroundMinutes", () => {
  it("takes a whole number of minutes from 0 to 240", () => {
    expect(parseMinTurnaroundMinutes("0")).toBe(0);
    expect(parseMinTurnaroundMinutes("45")).toBe(45);
    expect(parseMinTurnaroundMinutes("240")).toBe(240);
  });

  it("refuses anything else", () => {
    for (const raw of ["", " ", "-5", "241", "12.5", "thirty", null, undefined]) {
      expect(parseMinTurnaroundMinutes(raw)).toBeNull();
    }
  });
});
