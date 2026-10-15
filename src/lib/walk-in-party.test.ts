import { describe, expect, it } from "vitest";
import { readWalkInPartyRows, WALK_IN_PARTY_MAX, walkInMemberField } from "./walk-in-party";

describe("readWalkInPartyRows", () => {
  it("reads each row's name and tick, in row order, skipping blank rows", () => {
    expect(
      readWalkInPartyRows([
        ["fullName", "Ana Lopez"],
        [walkInMemberField(3, "name"), "Leo Lopez"],
        [walkInMemberField(1, "name"), "  Mia Lopez "],
        [walkInMemberField(1, "minor"), "true"],
        [walkInMemberField(2, "name"), "   "],
        [walkInMemberField(2, "minor"), "true"],
      ]),
    ).toEqual([
      { fullName: "Mia Lopez", minor: true },
      { fullName: "Leo Lopez", minor: false },
    ]);
  });

  it("never reads a tick onto a row it was not posted with", () => {
    expect(
      readWalkInPartyRows([
        [walkInMemberField(1, "name"), "Mia"],
        [walkInMemberField(2, "name"), "Leo"],
        [walkInMemberField(2, "minor"), "true"],
      ]),
    ).toEqual([
      { fullName: "Mia", minor: false },
      { fullName: "Leo", minor: true },
    ]);
  });

  it("reads no more rows than the form allows", () => {
    const entries: [string, string][] = Array.from({ length: 20 }, (_, index) => [
      walkInMemberField(index + 1, "name"),
      `Person ${index + 1}`,
    ]);
    expect(readWalkInPartyRows(entries)).toHaveLength(WALK_IN_PARTY_MAX - 1);
  });
});
