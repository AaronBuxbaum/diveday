import { describe, expect, it } from "vitest";
import { findPersonInserts } from "./check-person-door.mjs";

const lines = (source) => findPersonInserts(source).map((finding) => finding.line);

describe("a hand-written insert of a person", () => {
  it("is refused", () => {
    expect(lines("await tx.insert(people).values({ shopId });")).toEqual([1]);
  });

  it("is refused when the call is split across lines", () => {
    expect(lines("await tx\n  .insert(\n    people,\n  )\n  .values({});")).toEqual([2]);
  });

  it("passes when it says why", () => {
    expect(
      lines(
        "// diveday:allow-person-insert: a restore of a person this shop exported\nawait tx.insert(people).values(row);",
      ),
    ).toEqual([]);
  });

  it("leaves other tables and the role rows alone", () => {
    expect(
      lines("await tx.insert(personRoles).values({}); await tx.insert(peopleNotes).values({});"),
    ).toEqual([]);
  });
});
