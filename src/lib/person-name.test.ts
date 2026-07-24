import { describe, expect, it } from "vitest";
import { normalizePersonName, personNamesMatch } from "./person-name";

describe("normalizePersonName", () => {
  it("lower-cases, strips accents and punctuation, and collapses whitespace", () => {
    expect(normalizePersonName("  José  Q. Díaz ")).toBe("jose q diaz");
    expect(normalizePersonName("MARY-JANE  o'brien")).toBe("mary jane obrien");
  });
});

describe("personNamesMatch — the same person, tolerated noise", () => {
  it("matches on case, accents, and punctuation differences", () => {
    expect(personNamesMatch("José Díaz", "jose diaz")).toBe(true);
    expect(personNamesMatch("O'Brien, Mary", "mary obrien")).toBe(true);
  });

  it("ignores a middle initial on either side", () => {
    expect(personNamesMatch("Nora Quinn", "Nora Q. Quinn")).toBe(true);
    expect(personNamesMatch("Nora Q Quinn", "Nora Quinn")).toBe(true);
  });

  it("ignores word order", () => {
    expect(personNamesMatch("Jane Doe", "Doe Jane")).toBe(true);
  });
});

describe("personNamesMatch — a different person, flagged", () => {
  it("does not match a different first name under the same surname (the spouse case)", () => {
    expect(personNamesMatch("Jane Doe", "John Doe")).toBe(false);
  });

  it("does not match a different surname", () => {
    expect(personNamesMatch("Priya Sharma", "Priya Patel")).toBe(false);
  });

  it("does not match when a surname is added or dropped (a minor under a parent's email)", () => {
    expect(personNamesMatch("Jane Doe", "Jane Doe Smith")).toBe(false);
    expect(personNamesMatch("Jane", "Jane Doe")).toBe(false);
  });

  it("never matches when there is no significant token to compare", () => {
    expect(personNamesMatch("J. D.", "A. B.")).toBe(false);
    expect(personNamesMatch("", "Jane Doe")).toBe(false);
    expect(personNamesMatch("   ", "   ")).toBe(false);
  });
});
