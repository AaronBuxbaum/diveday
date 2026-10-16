import { describe, expect, it } from "vitest";
import { readWalkInParty, WALK_IN_PARTY_MAX, walkInMemberField } from "./walk-in-party";

const PERSON = "00000000-0000-4000-8000-000000000001";

describe("readWalkInParty", () => {
  it("reads each row's name, tick, type and date, in row order, skipping blank rows", () => {
    const party = readWalkInParty([
      ["fullName", "Ana Lopez"],
      [walkInMemberField(3, "name"), "Leo Lopez"],
      [walkInMemberField(3, "type"), "rider"],
      [walkInMemberField(1, "name"), "  Mia Lopez "],
      [walkInMemberField(1, "minor"), "true"],
      [walkInMemberField(1, "dob"), "2014-05-06"],
      [walkInMemberField(1, "type"), "snorkeler"],
      [walkInMemberField(2, "name"), "   "],
      [walkInMemberField(2, "minor"), "true"],
    ]);
    expect(party.invalid).toBe(false);
    expect(party.rows).toEqual([
      {
        row: 1,
        fullName: "Mia Lopez",
        minor: true,
        participantType: "snorkeler",
        dateOfBirth: "2014-05-06",
      },
      { row: 3, fullName: "Leo Lopez", minor: false, participantType: "rider" },
    ]);
  });

  it("never reads a tick onto a row it was not posted with", () => {
    const party = readWalkInParty([
      [walkInMemberField(1, "name"), "Mia"],
      [walkInMemberField(2, "name"), "Leo"],
      [walkInMemberField(2, "minor"), "true"],
    ]);
    expect(party.rows.map((row) => [row.fullName, row.minor])).toEqual([
      ["Mia", false],
      ["Leo", true],
    ]);
  });

  it("reads the first person's tick, date and on-file choice from row 0", () => {
    const party = readWalkInParty([
      ["fullName", "Ana Lopez"],
      [walkInMemberField(0, "minor"), "true"],
      [walkInMemberField(0, "dob"), "2010-01-02"],
      [walkInMemberField(0, "match"), PERSON],
      [walkInMemberField(1, "name"), "Mia"],
      [walkInMemberField(1, "match"), "new"],
    ]);
    expect(party.first).toEqual({ minor: true, dateOfBirth: "2010-01-02", match: PERSON });
    expect(party.rows[0]?.match).toBe("new");
  });

  it("keeps a date only beside a ticked Under 18", () => {
    const party = readWalkInParty([
      [walkInMemberField(1, "name"), "Mia"],
      [walkInMemberField(1, "dob"), "2014-05-06"],
    ]);
    expect(party.rows[0]?.dateOfBirth).toBeUndefined();
  });

  it("says a party is over the limit rather than dropping anyone", () => {
    const entries: [string, string][] = Array.from({ length: WALK_IN_PARTY_MAX }, (_, index) => [
      walkInMemberField(index + 1, "name"),
      `Person ${index + 1}`,
    ]);
    expect(readWalkInParty(entries).invalid).toBe(true);
    expect(readWalkInParty(entries.slice(0, WALK_IN_PARTY_MAX - 1)).invalid).toBe(false);
  });

  it("refuses a type, a date or a choice the form could not have sent", () => {
    for (const [field, value] of [
      ["type", "captain"],
      ["dob", "2099-01-01"],
      ["dob", "06/05/2014"],
      ["match", "someone"],
    ] as const) {
      const party = readWalkInParty([
        [walkInMemberField(1, "name"), "Mia"],
        [walkInMemberField(1, "minor"), "true"],
        [walkInMemberField(1, field), value],
      ]);
      expect(party.invalid, `${field}=${value}`).toBe(true);
    }
  });
});
