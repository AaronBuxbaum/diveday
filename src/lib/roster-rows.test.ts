import { describe, expect, it } from "vitest";
import { groupByLetter, rosterLetter, rosterRowFact } from "./roster-rows";

describe("rosterLetter", () => {
  it("files an accented name under its unaccented letter", () => {
    expect(rosterLetter("Ángel Ramos")).toBe("A");
    expect(rosterLetter("Björn Aasen")).toBe("B");
    expect(rosterLetter("Óscar Núñez")).toBe("O");
  });

  it("uppercases, and ignores leading whitespace", () => {
    expect(rosterLetter("  grace mensah")).toBe("G");
  });

  /**
   * A name starting with a digit or a symbol has no letter, and the roster
   * says so with its own group rather than inventing one — an imported roster
   * routinely carries "1st Mate" or "(no name given)".
   */
  it("has no letter for a name that does not start with one", () => {
    expect(rosterLetter("1st Mate")).toBeNull();
    expect(rosterLetter("")).toBeNull();
    expect(rosterLetter("   ")).toBeNull();
  });
});

describe("groupByLetter", () => {
  const row = (letter: string | null, name: string) => ({ letter, name });

  it("groups consecutive rows that share a letter", () => {
    const groups = groupByLetter([
      row("A", "Bjorn Aasen"),
      row("A", "Priscilla Adeyemi"),
      row("H", "Omar Haddad"),
    ]);
    expect(groups.map((group) => group.letter)).toEqual(["A", "H"]);
    expect(groups[0]?.rows.map((each) => each.name)).toEqual(["Bjorn Aasen", "Priscilla Adeyemi"]);
  });

  /**
   * **The query's order is the page's order.** Bucketing by letter would
   * re-sort the page underneath the pager, so "Page 3 of 7" would stop being
   * the third page of the list the count belongs to. A repeated letter is the
   * honest rendering of a sort that put one there.
   */
  it("never reorders: a letter that recurs opens a second group", () => {
    const groups = groupByLetter([row("A", "Aasen"), row("Z", "Zic"), row("A", "Ángel")]);
    expect(groups.map((group) => group.letter)).toEqual(["A", "Z", "A"]);
  });

  it("gives the letterless names a group of their own", () => {
    const groups = groupByLetter([row(null, "1st Mate"), row("A", "Aasen")]);
    expect(groups.map((group) => group.letter)).toEqual([null, "A"]);
  });

  it("returns nothing for no rows, so a page renders no group labels", () => {
    expect(groupByLetter([])).toEqual([]);
  });
});

describe("rosterRowFact", () => {
  const at = new Date("2026-08-27T11:00:00Z");
  const before = new Date("2026-08-26T11:00:00Z");

  it("prefers the seat ahead over the visit behind", () => {
    expect(rosterRowFact({ nextBookingAt: at, lastAboardAt: before, importedOnly: false })).toEqual(
      { kind: "booked", at },
    );
  });

  it("falls back to the last time they were aboard", () => {
    expect(
      rosterRowFact({ nextBookingAt: null, lastAboardAt: before, importedOnly: false }),
    ).toEqual({ kind: "lastAboard", at: before });
  });

  /**
   * A diver whose whole history came across from another system must not read
   * as one who has never been on a boat (ADR 20260725-import-prior-visits).
   */
  it("says so when every visit came across from another system", () => {
    expect(rosterRowFact({ nextBookingAt: null, lastAboardAt: null, importedOnly: true })).toEqual({
      kind: "imported",
    });
  });

  it("says nothing at all about a diver with no history — an absence is not a fact", () => {
    expect(
      rosterRowFact({ nextBookingAt: null, lastAboardAt: null, importedOnly: false }),
    ).toBeNull();
  });
});
