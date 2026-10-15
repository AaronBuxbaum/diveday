import { describe, expect, it } from "vitest";
import { judgeAgencyPage } from "./agency-check";

/**
 * Page shapes the judge reads beyond one name line (round 3, ideas 5 and 7):
 * a name split over two labeled lines, and the agency's own page furniture
 * under a result. The core rules are in `agency-check.test.ts`.
 */
const lena = {
  firstName: "Lena",
  lastName: "Ortiz",
  birthDate: "1990-04-12",
  cardNumber: "N-12345",
} as const;

function judge(
  pageText: string,
  overrides: Partial<Parameters<typeof judgeAgencyPage>[0]> = {},
): ReturnType<typeof judgeAgencyPage> {
  return judgeAgencyPage({
    agency: "naui",
    level: "open_water",
    ...lena,
    today: "2026-10-14",
    pageText,
    ...overrides,
  });
}

describe("judgeAgencyPage beside an agency's page furniture", () => {
  /** Found by the fixture corpus: SDI's note sits under every result. */
  it("ends a record at the agency's own page furniture, so its words are never the diver's", () => {
    const sdi = { agency: "sdi" } as const;
    const record = "Lena Ortiz\n1990-04-12\nOpen Water Scuba Diver";
    expect(
      judge(
        `${record}\n? Don't see your certification?\nIf your certification was in 2009 or previous it might not show up in this online search.`,
        sdi,
      ).verdict,
    ).toBe("match");
    // Furniture ends the record; it never lets one start or match.
    expect(judge("Request Certification\nLena Ortiz\n1990-04-12", sdi).verdict).toBe(
      "level_unconfirmed",
    );
    // A limiting word on the diver's own lines still limits.
    expect(judge(`${record} (Referral)\nRequest Certification`, sdi).verdict).toBe("limited_card");
  });
});

/**
 * **A name laid out over two labeled lines** (round 3, idea 5): "First name:
 * Lena" over "Last name: Ortiz", a plausible NAUI, CMAS or DiveChek shape. It
 * reads as the diver's name line only when the two lines are adjacent, each is
 * one label and only the diver's own name, and the pair opens the record. A
 * neighbor's "Last name" further down never completes this diver's first name.
 */
describe("judgeAgencyPage on a name split over two labeled lines", () => {
  const split = (first: string, last: string, ...rest: string[]) =>
    [first, last, ...rest].join("\n");

  it("reads a first-name line over a last-name line as the diver's name", () => {
    const page = split(
      "First name: Lena",
      "Last name: Ortiz",
      "Date of birth: 04/12/1990",
      "Certification: Scuba Diver",
    );
    expect(judge(page)).toEqual({
      verdict: "match",
      evidence: "Lena Ortiz · Date of birth: 04/12/1990 · Certification: Scuba Diver",
    });
  });

  it.each([
    ["FIRST NAME: Léna", "LAST NAME: ORTÍZ"],
    ["Given names: Lena María", "Family name: Ortiz"],
    ["Forename: Lena", "Surname: Ortiz"],
    ["First Name Lena", "Last Name Ortiz"],
    ["Surname: Ortiz", "Given name: Lena"],
    ["Nombre: Lena", "Apellidos: Ortiz"],
  ])("reads %s over %s, accents, case, middle names and order aside", (first, last) => {
    expect(judge(split(first, last, "04/12/1990", "Scuba Diver")).verdict).toBe("match");
  });

  it("reads a compound family name ending in the diver's last name", () => {
    expect(
      judge(split("First name: Lena", "Last name: de la Ortiz", "04/12/1990", "Scuba Diver"))
        .verdict,
    ).toBe("match");
  });

  it("still needs the birth date it searched by", () => {
    expect(
      judge(split("First name: Lena", "Last name: Ortiz", "1985-07-01", "Scuba Diver")),
    ).toEqual({ verdict: "namesake" });
  });

  it("never pairs lines that are not adjacent, so a neighbor's last name does not complete hers", () => {
    const page = [
      "First name: Lena",
      "Date of birth: 04/12/1990",
      "Scuba Diver",
      "Last name: Ortiz",
    ].join("\n");
    expect(judge(page).verdict).toBe("unreadable");
    const neighbor = [
      "First name: Lena",
      "Last name: Smith",
      "Date of birth: 04/12/1990",
      "Scuba Diver",
      "Last name: Ortiz",
    ].join("\n");
    expect(judge(neighbor).verdict).not.toBe("match");
  });

  it("never reads a pair whose line also carries a rating, a date or someone else", () => {
    expect(
      judge(split("First name: Lena", "Last name: Ortiz Scuba Diver", "04/12/1990")).verdict,
    ).not.toBe("match");
    expect(
      judge(split("First name: Lena", "Last name: Ortiz 04/12/1990", "Scuba Diver")).verdict,
    ).not.toBe("match");
    expect(
      judge(split("First name: Lena", "Last name: Ortiz Instructor Mark Lee Smith", "04/12/1990"))
        .verdict,
    ).not.toBe("match");
    expect(
      judge(split("First name: Lenara", "Last name: Ortiz", "04/12/1990", "Scuba Diver")).verdict,
    ).toBe("unreadable");
  });

  it("never reads two of the same label as a name", () => {
    expect(
      judge(split("First name: Lena", "First name: Ortiz", "04/12/1990", "Scuba Diver")).verdict,
    ).toBe("unreadable");
  });

  it("leaves a label on its own line above its value unread, failing closed", () => {
    const page = [
      "First name",
      "Lena",
      "Last name",
      "Ortiz",
      "Date of birth",
      "04/12/1990",
      "Scuba Diver",
    ].join("\n");
    expect(judge(page).verdict).toBe("unreadable");
  });

  it("reads a table row whose first and last names sit in separate cells", () => {
    const page = [
      "First Name\tLast Name\tDate of Birth\tCertification",
      "Lena\tOrtiz\t04/12/1990\tScuba Diver",
    ].join("\n");
    expect(judge(page).verdict).toBe("match");
  });

  it("reads 'no record' under a search echo as no record", () => {
    expect(judge(split("First name: Lena", "Last name: Ortiz", "No record was found."))).toEqual({
      verdict: "no_record",
    });
  });

  describe("on PADI DiveChek", () => {
    const padi = (
      pageText: string,
      overrides: Partial<Parameters<typeof judgeAgencyPage>[0]> = {},
    ) => judge(pageText, { agency: "padi", cardNumber: null, ...overrides });
    const SPLIT = split(
      "First Name: Lena",
      "Last Name: Ortiz",
      "Date of Birth: 12 Apr 1990",
      "Open Water Diver 15 Jun 2015",
    );

    it("takes the birth date from the line under the pair", () => {
      expect(padi(SPLIT)).toEqual({
        verdict: "match",
        evidence: "Lena Ortiz · Date of Birth: 12 Apr 1990 · Open Water Diver 15 Jun 2015",
      });
    });

    it("still groups by birth date, so two split records under the name are several divers", () => {
      const page = [
        SPLIT,
        "First Name: Lena",
        "Last Name: Ortiz",
        "Date of Birth: 3 Sep 1987",
        "Advanced Open Water Diver 2 Feb 2020",
      ].join("\n");
      expect(padi(page)).toEqual({ verdict: "several_records" });
    });

    it("ends the record at a neighbor's split name", () => {
      const page = [
        "First Name: Lena",
        "Last Name: Ortiz",
        "Date of Birth: 12 Apr 1990",
        "First Name: Mark",
        "Last Name: Lee",
        "Advanced Open Water Diver 2 Feb 2020",
      ].join("\n");
      expect(padi(page, { level: "advanced_open_water" }).verdict).not.toBe("match");
      expect(JSON.stringify(padi(page))).not.toContain("Mark");
    });
  });
});
