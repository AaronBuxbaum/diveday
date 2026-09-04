import { describe, expect, it } from "vitest";
import { composeMovePreflight, type MovePreflightFacts } from "./move-preflight";

/** A departure nothing has happened to: on the board, empty, untouched. */
const quiet: MovePreflightFacts = {
  toldSeats: 0,
  gearReserved: 0,
  paidOrders: 0,
  cancellationWindowHours: null,
  rollCallEvidence: 0,
  scheduled: true,
  crewClashes: [],
  crewAway: [],
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

  it("orders the sections crew, people, kit, money", () => {
    const full = composeMovePreflight({
      toldSeats: 4,
      gearReserved: 3,
      paidOrders: 5,
      cancellationWindowHours: 48,
      rollCallEvidence: 0,
      scheduled: true,
      crewClashes: [{ name: "Marcus Webb", departure: "Night Dive" }],
      crewAway: [],
    });
    expect(full.sections.map((section) => section.kind)).toEqual(["crew", "told", "gear", "money"]);
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

    it("says a cancelled departure will be refused", () => {
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
});
