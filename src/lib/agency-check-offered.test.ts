import { describe, expect, it } from "vitest";
import { agencyCheckOffered, agencyCheckQuery, judgeAgencyPage } from "./agency-check";

/**
 * Who is offered a check, and the agencies' own "nobody found" wording, read
 * against their real pages (2026-10-15). `agency-check.test.ts` holds the rest
 * of the judge.
 */
describe("agencyCheckOffered", () => {
  it("offers SSI's manual form with names and birthday without a card number", () => {
    const input = {
      agency: "ssi" as const,
      fullName: "Lena Ortiz",
      dateOfBirth: "1990-04-12",
      identifier: null,
    };
    expect(agencyCheckQuery(input)).toMatchObject({
      firstName: "Lena",
      lastName: "Ortiz",
      birthDate: "1990-04-12",
      cardNumber: null,
    });
    expect(agencyCheckQuery({ ...input, dateOfBirth: null })?.birthDate).toBeNull();
    expect(agencyCheckQuery({ ...input, fullName: "Lena" })).toMatchObject({
      firstName: "Lena",
      lastName: "",
    });
    expect(
      judgeAgencyPage({
        agency: "ssi",
        level: "open_water",
        firstName: "Lena",
        lastName: "Ortiz",
        birthDate: "1990-04-12",
        cardNumber: null,
        today: "2026-10-26",
        pageText: "Lena Ortiz\n1990-04-12\nOpen Water Diver",
      }).verdict,
    ).not.toBe("match");
  });
  it("offers PADI only at a shop that turned PADI checks on, and every other agency anywhere", () => {
    expect(agencyCheckOffered("padi", { padiChecksEnabled: false })).toBe(false);
    expect(agencyCheckOffered("padi", { padiChecksEnabled: true })).toBe(true);
    for (const agency of ["ssi", "naui", "sdi", "gue", "cmas"] as const) {
      expect(agencyCheckOffered(agency, { padiChecksEnabled: false }), agency).toBe(true);
    }
  });

  /** Domain review R4-4: a course's agency is free text, so "PADI" is PADI. */
  it("reads a course's free-text agency however it is written", () => {
    for (const agency of ["PADI", " padi ", "Padi"]) {
      expect(agencyCheckOffered(agency, { padiChecksEnabled: false }), agency).toBe(false);
      expect(agencyCheckOffered(agency, { padiChecksEnabled: true }), agency).toBe(true);
    }
  });
});

describe("judgeAgencyPage on an agency's own 'nobody found'", () => {
  it("reads NAUI's 'No record was found.' as no record, not an unreadable page", () => {
    expect(
      judgeAgencyPage({
        agency: "naui",
        level: "open_water",
        firstName: "Lena",
        lastName: "Ortiz",
        birthDate: "1990-04-12",
        cardNumber: null,
        today: "2026-10-14",
        pageText: "Verify Diver Certification\nFirst Name\nLast Name\nNo record was found.",
      }),
    ).toEqual({ verdict: "no_record" });
  });
});
