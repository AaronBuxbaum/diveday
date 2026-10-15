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

  /** Operational review: a limit written beside the furniture was cut off with it. */
  it("reads furniture only at the start of a line, so a limit before it still limits", () => {
    const sdi = { agency: "sdi", cardNumber: "SDI-1001" } as const;
    const record = "Lena Ortiz\n1990-04-12\nOpen Water Scuba Diver SDI-1001";
    expect(judge(`${record}\nPending — Request Certification`, sdi).verdict).toBe("limited_card");
    expect(judge(`${record}\nRequest Certification (pending)`, sdi).verdict).toBe("limited_card");
    expect(
      judge("Lena Ortiz\n1990-04-12\nOpen Water Scuba Diver · Request Certification", sdi).verdict,
    ).toBe("match");
  });

  it("ends a record at a search control on its own line", () => {
    for (const control of ["Manual Search", "Search", "Verify another card", "Back to search"]) {
      expect(
        judge(`Lena Ortiz\n1990-04-12\n${control}\nOpen Water Scuba Diver`, { agency: "sdi" })
          .verdict,
        control,
      ).toBe("level_unconfirmed");
    }
  });

  /** Security review: a neighbor's name inside the window is never kept as a review note. */
  it("keeps only the record's own kinds of words as evidence", () => {
    const result = judge("Lena Ortiz\n1990-04-12\nOpen Water Scuba Diver\nMark Lee\n1980-01-01", {
      agency: "sdi",
    });
    expect(result.verdict).toBe("match");
    expect(JSON.stringify(result)).not.toContain("Mark");
    expect(JSON.stringify(result)).not.toContain("Lee");
  });
});

/** Operational review: "Jr." straight after the diver's last name is part of their name. */
describe("judgeAgencyPage on a name suffix", () => {
  const robert = { firstName: "Robert", lastName: "Smith", agency: "sdi" } as const;
  it("reads Jr. after the last name as a suffix, not a junior rating", () => {
    for (const name of ["Robert Smith Jr.", "Robert Smith Junior", "ROBERT SMITH, JR"]) {
      expect(judge(`${name}\n1990-04-12\nOpen Water Scuba Diver`, robert).verdict, name).toBe(
        "match",
      );
    }
  });
  it("still limits a junior rating written after the name, or elsewhere in the record", () => {
    expect(judge("Robert Smith Jr Open Water Scuba Diver\n1990-04-12", robert).verdict).toBe(
      "limited_card",
    );
    expect(
      judge("Robert Smith Jr.\n1990-04-12\nJunior Open Water Scuba Diver", robert).verdict,
    ).toBe("limited_card");
    expect(judge("Robert Jr Smith\n1990-04-12\nOpen Water Scuba Diver", robert).verdict).toBe(
      "limited_card",
    );
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
      "Certification: Scuba Diver 06/15/2015",
    );
    expect(judge(page)).toEqual({
      verdict: "match",
      evidence: "Lena Ortiz · Date of birth: 04/12/1990 · Certification: Scuba Diver 06/15/2015",
    });
  });

  it.each([
    ["FIRST NAME: Léna", "LAST NAME: ORTÍZ"],
    ["Given name: Lena María", "Family name: Ortiz"],
    ["Forename: Lena", "Surname: Ortiz"],
    ["First Name Lena", "Last Name Ortiz"],
    ["Surname: Ortiz", "Given name: Lena"],
    ["Nombre: Lena", "Apellidos: Ortiz"],
  ])("reads %s over %s, accents, case, middle names and order aside", (first, last) => {
    expect(judge(split(first, last, "04/12/1990", "Scuba Diver 2015")).verdict).toBe("match");
  });

  it("reads a compound family name ending in the diver's last name", () => {
    expect(
      judge(split("First name: Lena", "Last name: de la Ortiz", "04/12/1990", "Scuba Diver 2015"))
        .verdict,
    ).toBe("match");
  });

  /** Operational review: hyphenated names pair as they read on one line. */
  it("reads hyphenated given and family names", () => {
    expect(
      judge(
        split("First name: Mary-Jane", "Last name: Ortiz-Lee", "04/12/1990", "Scuba Diver 2015"),
        {
          firstName: "Mary-Jane",
          lastName: "Ortiz-Lee",
        },
      ).verdict,
    ).toBe("match");
  });

  /** Adversarial review #1: one record's family line never pairs with the next record's given line. */
  it("pairs labeled lines top to bottom, so two records never make a third", () => {
    const familyFirst = [
      "Surname: Lee",
      "Given name: Lena",
      "Surname: Ortiz",
      "Given name: Mark",
      "Date of birth: 04/12/1990",
      "Rescue Scuba Diver 2015",
    ].join("\n");
    const rescue = judge(familyFirst, { level: "rescue" });
    expect(rescue.verdict).not.toBe("match");
    expect(JSON.stringify(rescue)).not.toContain("Mark");
    const givenFirst = [
      "First name: Mark",
      "Last name: Ortiz",
      "First name: Lena",
      "Last name: Lee",
      "Date of birth: 04/12/1990",
      "Scuba Diver 2015",
    ].join("\n");
    expect(judge(givenFirst).verdict).not.toBe("match");
  });

  it("refuses a pair beside a stray labeled name line", () => {
    for (const page of [
      [
        "First name: Mark",
        "First name: Lena",
        "Last name: Ortiz",
        "04/12/1990",
        "Scuba Diver 2015",
      ],
      ["Given name: Lena", "Surname: Ortiz", "Given name: Mark", "04/12/1990", "Scuba Diver 2015"],
    ]) {
      expect(judge(page.join("\n")).verdict, page.join(" / ")).toBe("unreadable");
    }
  });

  /** Security review #4: the search form echoed back with a menu's level under it is no result. */
  it("reads the search form echoed under its labels, a menu's level below, as no result", () => {
    expect(
      judge(
        split(
          "First Name: Lena",
          "Last Name: Ortiz",
          "Date of Birth: 04/12/1990",
          "Open Water Diver",
        ),
      ).verdict,
    ).toBe("unreadable");
  });

  /** Operational review #2: a labeled search echo above another diver's result. */
  it("ends a split record at a line that is not part of a record", () => {
    const page = [
      "Given Name: Lena",
      "Family Name: Ortiz",
      "Birthdate: 12.04.1990",
      "Manual Search",
      "One Star Diver",
      "Federation: FFESSM",
      "Name: Lena Ortiz",
      "Birthdate: 01.07.1985",
    ].join("\n");
    expect(judge(page, { agency: "cmas", cardNumber: null }).verdict).not.toBe("match");
    const noControl = page.replace("Manual Search\n", "Status: Active\n");
    expect(judge(noControl, { agency: "cmas", cardNumber: null }).verdict).not.toBe("match");
  });

  it("still needs the birth date it searched by", () => {
    expect(
      judge(split("First name: Lena", "Last name: Ortiz", "1985-07-01", "Scuba Diver 2015")),
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
    expect(judge(neighbor).verdict).toBe("unreadable");
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

/** Review of the extension's page-shape commit: a broken page is never the agency saying no. */
describe("judgeAgencyPage on a page that is not the agency's answer", () => {
  it("reads a 404 or a moved form as unreadable, never no record", () => {
    for (const page of [
      "404 – Page not found",
      "Page Not Found\nThe page you requested was not found.",
    ]) {
      expect(judge(page).verdict, page).toBe("unreadable");
    }
  });

  it("still reads the agencies' own no-record wording", () => {
    for (const page of [
      "No record found.",
      "No diver found",
      "No record was found.",
      "No results",
    ]) {
      expect(judge(page).verdict, page).toBe("no_record");
    }
  });

  it("counts a split-name record as a second DiveChek diver", () => {
    const page = [
      "2 results",
      "Lena Ortiz",
      "Date of Birth: 04/12/1990",
      "Open Water Diver",
      "First name: Lena",
      "Last name: Ortiz",
      "Date of Birth: 09/03/1987",
      "Advanced Open Water Diver",
    ].join("\n");
    expect(judge(page, { agency: "padi", cardNumber: null })).toEqual({
      verdict: "several_records",
    });
  });
});
