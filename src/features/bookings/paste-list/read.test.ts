import { describe, expect, it } from "vitest";
import { MAX_IMPORT_BYTES } from "@/lib/import";
import { PASTE_LIST_MAX_ROWS, readPastedList } from "./read";

function people(text: string) {
  const read = readPastedList(text);
  if (!read.ok) throw new Error(`refused: ${read.reason}`);
  return read;
}

describe("readPastedList", () => {
  it("reads a spreadsheet's tab-separated rows with a header", () => {
    const read = people(
      "Name\tEmail\tPhone\nAna López\tana@example.com\t+1 305 555 0101\nBen Ortiz\t\t305-555-0102\n",
    );
    expect(read.people).toEqual([
      {
        row: 2,
        fullName: "Ana López",
        email: "ana@example.com",
        phone: "+1 305 555 0101",
        dropped: [],
      },
      { row: 3, fullName: "Ben Ortiz", phone: "305-555-0102", dropped: [] },
    ]);
  });

  it("reads columns in any order by their header, the importer's aliases included", () => {
    const read = people("Mobile,E-mail,Customer Name\n3055550101,ana@example.com,Ana López\n");
    expect(read.people[0]).toMatchObject({
      fullName: "Ana López",
      email: "ana@example.com",
      phone: "3055550101",
    });
  });

  it("reads a booking tool's guest and passenger headers", () => {
    expect(people("Guest Name,Email\nAna López,ana@example.com").people[0]?.fullName).toBe(
      "Ana López",
    );
    expect(people("Passenger name\nBen Ortiz").people[0]?.fullName).toBe("Ben Ortiz");
  });

  it("joins a first and a last name column", () => {
    const read = people("First Name,Last Name,Email\nAna,López,ana@example.com\n");
    expect(read.people[0]?.fullName).toBe("Ana López");
  });

  it("reads a list with no header by what its cells look like", () => {
    const read = people(
      "ana@example.com\tAna López\t+1 305 555 0101\nben@example.com\tBen Ortiz\t+1 305 555 0102\n",
    );
    expect(read.people.map((person) => [person.row, person.fullName, person.email])).toEqual([
      [1, "Ana López", "ana@example.com"],
      [2, "Ben Ortiz", "ben@example.com"],
    ]);
    expect(read.people[1]?.phone).toBe("+1 305 555 0102");
  });

  it("joins one-word first and last name columns when there is no header", () => {
    const read = people("Ana,López,ana@example.com\nBen,Ortiz,ben@example.com\n");
    expect(read.people.map((person) => person.fullName)).toEqual(["Ana López", "Ben Ortiz"]);
  });

  it("reads a bare list of names, one a line", () => {
    const read = people("Ana López\nBen Ortiz\n\nCarla Ruiz\n");
    expect(read.people.map((person) => person.fullName)).toEqual([
      "Ana López",
      "Ben Ortiz",
      "Carla Ruiz",
    ]);
  });

  it("reads quoted cells with commas and line endings from every tool", () => {
    const read = people('Name,Email\r\n"Ortiz, Ben",ben@example.com\r\n"Ana ""Shark"" López",\r\n');
    expect(read.people.map((person) => person.fullName)).toEqual([
      "Ortiz, Ben",
      'Ana "Shark" López',
    ]);
  });

  it("strips a byte-order mark so the first header still reads", () => {
    const read = people("﻿Name,Email\nAna López,ana@example.com\n");
    expect(read.people).toHaveLength(1);
    expect(read.people[0]?.email).toBe("ana@example.com");
  });

  it("reads a semicolon-separated export", () => {
    const read = people("Name;Email\nAna López;ana@example.com\n");
    expect(read.people[0]).toMatchObject({ fullName: "Ana López", email: "ana@example.com" });
  });

  it("skips rows with no name to seat, and says what each one held", () => {
    const read = people("Name,Email\nAna López,ana@example.com\n,orphan@example.com\n12,\n---,\n");
    expect(read.people.map((person) => person.fullName)).toEqual(["Ana López"]);
    expect(read.skipped).toEqual([
      { row: 3, text: "orphan@example.com" },
      { row: 4, text: "12" },
      { row: 5, text: "---" },
    ]);
  });

  it("seats a name with a digit in it, since only a row with no letters is no one", () => {
    const read = people("Ana López 2\nSam (+1)\nBen Ortiz\n");
    expect(read.people.map((person) => person.fullName)).toEqual([
      "Ana López 2",
      "Sam (+1)",
      "Ben Ortiz",
    ]);
    expect(read.skipped).toEqual([]);
  });

  it("keeps two people with one name and no contact, since nothing says they are one", () => {
    const read = people("Maria Garcia\nMaria Garcia\n");
    expect(read.people.map((person) => [person.row, person.fullName])).toEqual([
      [1, "Maria Garcia"],
      [2, "Maria Garcia"],
    ]);
    expect(read.duplicates).toBe(0);
  });

  it("keeps a person whose contact cannot be read, and says which was left off", () => {
    const read = people("Name,Email,Phone\nAna López,not an address,12\n");
    expect(read.people[0]).toEqual({
      row: 2,
      fullName: "Ana López",
      dropped: ["email", "phone"],
    });
  });

  it("drops an exact repeat but keeps a family sharing one email and phone", () => {
    const read = people(
      [
        "Name,Email,Phone",
        "Ana López,family@example.com,3055550101",
        "Ben López,family@example.com,3055550101",
        "Ana López,family@example.com,3055550101",
        "ana lópez,FAMILY@example.com,(305) 555-0101",
      ].join("\n"),
    );
    expect(read.people.map((person) => person.fullName)).toEqual(["Ana López", "Ben López"]);
    expect(read.duplicates).toBe(2);
  });

  it("lowercases an address", () => {
    expect(people("Ana López,Ana@Example.com").people[0]?.email).toBe("ana@example.com");
  });

  it("takes a spreadsheet's formula guard off a name", () => {
    expect(people("Name\n'=Ana").people[0]?.fullName).toBe("=Ana");
  });

  it(`reads ${PASTE_LIST_MAX_ROWS} people and refuses one more`, () => {
    const rows = (count: number) =>
      Array.from(
        { length: count },
        (_, index) =>
          `Diver ${String.fromCharCode(65 + (index % 26))}${String.fromCharCode(65 + Math.floor(index / 26))}\tdiver${index}@example.com`,
      );
    expect(people(["Name\tEmail", ...rows(PASTE_LIST_MAX_ROWS)].join("\n")).people).toHaveLength(
      PASTE_LIST_MAX_ROWS,
    );
    expect(readPastedList(["Name\tEmail", ...rows(PASTE_LIST_MAX_ROWS + 1)].join("\n"))).toEqual({
      ok: false,
      reason: "too_many_rows",
    });
  });

  it("refuses what has nothing to read", () => {
    expect(readPastedList("")).toEqual({ ok: false, reason: "empty" });
    expect(readPastedList(" \n\t\n")).toEqual({ ok: false, reason: "empty" });
    expect(readPastedList("Email\nana@example.com")).toEqual({ ok: false, reason: "no_names" });
    expect(readPastedList("3055550101\n3055550102")).toEqual({ ok: false, reason: "no_names" });
  });

  it("refuses a paste past the importer's bounds", () => {
    expect(readPastedList("a".repeat(MAX_IMPORT_BYTES + 1))).toEqual({
      ok: false,
      reason: "too_large",
    });
    expect(readPastedList(`Ana,${"x".repeat(2_001)}`)).toEqual({
      ok: false,
      reason: "cell_too_long",
    });
    expect(readPastedList(`Ana${",x".repeat(64)}`)).toEqual({
      ok: false,
      reason: "too_many_columns",
    });
  });
});
