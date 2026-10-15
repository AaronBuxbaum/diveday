import { describe, expect, it } from "vitest";
import { judgeAgencyPage } from "./agency-check";

const DIVECHEK = [
  "DiveChek",
  "1 diver found",
  "Lena Ortiz",
  "Date of Birth: 12 Apr 1990",
  "Open Water Diver 15 Jun 2015 1506AB1234",
].join("\n");

const padi = (cardNumber: string) =>
  judgeAgencyPage({
    agency: "padi",
    level: "open_water",
    firstName: "Lena",
    lastName: "Ortiz",
    birthDate: "1990-04-12",
    cardNumber,
    today: "2026-10-14",
    pageText: DIVECHEK,
  }).verdict;

describe("a card number on the agency's page (#2592)", () => {
  it("is read as a whole token, never as a piece of a longer one", () => {
    // A number typed short, or the tail of the record's, is another card.
    expect(padi("1506AB12")).toBe("level_unconfirmed");
    expect(padi("06AB1234")).toBe("level_unconfirmed");
    expect(padi("AB1234")).toBe("level_unconfirmed");
  });

  it("still reads separators the shop typed inside the number as one number", () => {
    expect(padi("1506AB1234")).toBe("match");
    expect(padi("1506 AB 1234")).toBe("match");
    expect(padi("1506-ab-1234")).toBe("match");
  });
});
