import { describe, expect, it } from "vitest";
import { isPlausibleCardNumber, MAX_CARD_NUMBER_LENGTH } from "./card-number";

/**
 * The field that turns a diver's claim into the shop's evidence. Both halves
 * matter and pull opposite ways: the check has to refuse the things a hurried
 * staffer types to get past a required box, and it has to accept every shape a
 * real agency card comes in, because refusing a genuine card is what sends a
 * decision back to the rail.
 */
describe("isPlausibleCardNumber", () => {
  it("accepts the shapes real agency cards come in", () => {
    for (const value of [
      "1902081234", // PADI: digits only
      "SSI-4839201", // hyphenated
      "AOW 55 12 993", // spaces
      "NAUI#88213",
      "  padi 12345  ", // trimmed before it is judged
      "R2-D2", // short, but a digit and four characters
      "A47", // an old BSAC/CMAS-federation member number, three characters
    ]) {
      expect(isPlausibleCardNumber(value)).toBe(true);
    }
  });

  it("refuses what somebody types to get past a required box", () => {
    // "xx" is the one that shipped: two characters cleared the old bound and
    // certified a self-declared "Instructor" outright.
    for (const value of ["xx", "", "   ", "-", "n/a", "none", "asdf", "same as above"]) {
      expect(isPlausibleCardNumber(value)).toBe(false);
    }
  });

  it("refuses more than the column's own bound", () => {
    expect(isPlausibleCardNumber(`1${"9".repeat(MAX_CARD_NUMBER_LENGTH - 1)}`)).toBe(true);
    expect(isPlausibleCardNumber("9".repeat(MAX_CARD_NUMBER_LENGTH + 1))).toBe(false);
  });

  it("counts a non-ASCII digit as a digit", () => {
    // A staffer typing on an Arabic-Indic keyboard is holding a real card; the
    // check exists to catch words, not to insist on ASCII.
    expect(isPlausibleCardNumber("١٢٣٤")).toBe(true);
  });
});
