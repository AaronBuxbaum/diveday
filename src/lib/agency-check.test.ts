import { describe, expect, it } from "vitest";
import {
  AGENCY_CHECKS,
  agencyCheckQuery,
  EVIDENCE_MAX_LENGTH,
  foldText,
  isCheckableAgency,
  judgeAgencyPage,
} from "./agency-check";
import { AGENCY_VERIFICATION_PAGES } from "./agency-verification";

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
  return judgeAgencyPage({ agency: "naui", level: "open_water", ...lena, pageText, ...overrides });
}

describe("agencyCheckQuery", () => {
  const base = {
    agency: "naui",
    fullName: "Lena María Ortiz",
    dateOfBirth: "1990-04-12",
    identifier: "N-12345",
  } as const;

  it("types the first and last words of the name, with only what the agency's form asks for", () => {
    expect(agencyCheckQuery(base)).toEqual({
      agency: "naui",
      firstName: "Lena",
      lastName: "Ortiz",
      birthDate: "1990-04-12",
      cardNumber: null,
    });
    expect(agencyCheckQuery({ ...base, agency: "ssi" })).toEqual({
      agency: "ssi",
      firstName: "Lena",
      lastName: "Ortiz",
      birthDate: null,
      cardNumber: "N-12345",
    });
  });

  /**
   * The query crosses to the extension and is typed into a third party's page:
   * a diver's birth date never goes to an agency that looks up by number, nor
   * a card number to one that looks up by birth date. CMAS takes either.
   */
  it("hands the extension nothing the agency's form does not ask for", () => {
    for (const agency of ["ssi", "gue"] as const) {
      expect(agencyCheckQuery({ ...base, agency })?.birthDate).toBeNull();
    }
    for (const agency of ["naui", "sdi", "padi"] as const) {
      expect(agencyCheckQuery({ ...base, agency })?.cardNumber).toBeNull();
    }
    expect(agencyCheckQuery({ ...base, agency: "cmas" })).toMatchObject({
      birthDate: "1990-04-12",
      cardNumber: "N-12345",
    });
  });

  it("checks nothing for TDI, whose recreational cards are SDI's, or for an agency with no lookup", () => {
    for (const agency of ["tdi", "raid", "bsac", "iantd", "nss_cds", "nacd", "other"] as const) {
      expect(agencyCheckQuery({ ...base, agency })).toBeNull();
    }
  });

  it("needs a birth date where the form asks for one", () => {
    for (const agency of ["naui", "sdi", "padi"] as const) {
      expect(agencyCheckQuery({ ...base, agency, dateOfBirth: null })).toBeNull();
    }
  });

  it("needs a card number where the form asks for one", () => {
    for (const agency of ["ssi", "gue"] as const) {
      expect(agencyCheckQuery({ ...base, agency, identifier: null })).toBeNull();
      expect(agencyCheckQuery({ ...base, agency, identifier: "  " })).toBeNull();
    }
  });

  it("takes either for CMAS, and neither is not enough", () => {
    expect(agencyCheckQuery({ ...base, agency: "cmas", identifier: null })).not.toBeNull();
    expect(agencyCheckQuery({ ...base, agency: "cmas", dateOfBirth: null })).not.toBeNull();
    expect(
      agencyCheckQuery({ ...base, agency: "cmas", identifier: null, dateOfBirth: null }),
    ).toBeNull();
  });

  it("checks nothing for a one-word name, which has no last name to type", () => {
    expect(agencyCheckQuery({ ...base, fullName: "Lena" })).toBeNull();
  });

  it("drops a birth date that is not a calendar date", () => {
    expect(
      agencyCheckQuery({ ...base, agency: "cmas", dateOfBirth: "12/04/1990" })?.birthDate,
    ).toBe(null);
  });

  it("only checks agencies that publish a lookup page", () => {
    for (const agency of Object.keys(AGENCY_CHECKS)) {
      expect(isCheckableAgency(agency)).toBe(true);
      const page = AGENCY_VERIFICATION_PAGES[agency as keyof typeof AGENCY_VERIFICATION_PAGES];
      expect(page).toBeDefined();
    }
  });

  it("types PADI's DiveChek the diver's name and birth date", () => {
    expect(agencyCheckQuery({ ...base, agency: "padi", identifier: null })).toEqual({
      agency: "padi",
      firstName: "Lena",
      lastName: "Ortiz",
      birthDate: "1990-04-12",
      cardNumber: null,
    });
  });
});

describe("foldText", () => {
  it("drops accents, case and punctuation", () => {
    expect(foldText("  ZOË  O'Brien-Smith ")).toBe("zoe o brien smith");
    expect(foldText("Stress & Rescue")).toBe("stress & rescue");
  });
});

describe("judgeAgencyPage", () => {
  it("matches the diver's name, birth date and the claimed level in one record", () => {
    const result = judge(
      [
        "Verify Diver Certification",
        "Lena Ortiz",
        "Date of birth: 1990-04-12",
        "Certification: Scuba Diver",
        "Issued: 2019-03-02",
      ].join("\n"),
    );
    expect(result).toEqual({
      verdict: "match",
      evidence:
        "Lena Ortiz · Date of birth: 1990-04-12 · Certification: Scuba Diver · Issued: 2019-03-02",
    });
  });

  it.each(["04/12/1990", "4/12/1990", "12.04.1990", "April 12, 1990", "12 Apr 1990"])(
    "reads the birth date written as %s",
    (date) => {
      expect(judge(`Lena Ortiz\n${date}\nScuba Diver`).verdict).toBe("match");
    },
  );

  it("never matches without the birth date it searched by, so a namesake is not certified", () => {
    expect(judge("Lena Ortiz\nScuba Diver").verdict).toBe("level_unconfirmed");
    expect(judge("Lena Ortiz\n1985-07-01\nScuba Diver").verdict).toBe("level_unconfirmed");
  });

  it("tells two divers with one name apart by birth date", () => {
    const page = [
      "Lena Ortiz",
      "1985-07-01",
      "Advanced Scuba Diver",
      "Lena Ortiz",
      "1990-04-12",
      "Skin Diver",
    ].join("\n");
    expect(judge(page, { level: "advanced_open_water" }).verdict).toBe("level_unconfirmed");
  });

  it("never reads the next row's level as this diver's", () => {
    const page = [
      "Lena Ortiz",
      "1990-04-12",
      "Skin Diver",
      "Sam Ortiz",
      "Advanced Scuba Diver",
    ].join("\n");
    expect(judge(page, { level: "advanced_open_water" }).verdict).toBe("level_unconfirmed");
  });

  it("needs the card number where the agency searches by it", () => {
    const ssi = { agency: "ssi", cardNumber: "776 5432 1" } as const;
    expect(judge("Lena Ortiz\nCard 77654321\nOpen Water Diver", ssi).verdict).toBe("match");
    expect(judge("Lena Ortiz\nCard 99999999\nOpen Water Diver", ssi).verdict).toBe(
      "level_unconfirmed",
    );
  });

  it("takes either for CMAS", () => {
    const cmas = { agency: "cmas", level: "advanced_open_water", cardNumber: "CMAS-77" } as const;
    expect(judge("Lena Ortiz\nCMAS-77\n2-Star Diver", cmas).verdict).toBe("match");
    expect(judge("Lena Ortiz\n1990-04-12\n2 Star Diver", cmas).verdict).toBe("match");
  });

  it("needs first and last name on one line, in order", () => {
    expect(judge("Lena María Ortiz\n1990-04-12\nScuba Diver").verdict).toBe("match");
    expect(judge("Jane Doe\nInstructor: Lena Smith\nOrtiz\n1990-04-12\nScuba Diver").verdict).toBe(
      "unreadable",
    );
    expect(judge("Ortiz Lena\n1990-04-12\nScuba Diver").verdict).toBe("unreadable");
  });

  it("ignores accents and case on both sides", () => {
    expect(judge("LENA ORTÍZ\n1990-04-12\nopen water diver").verdict).toBe("match");
  });

  it("takes a higher rating's wording as the lower one it contains", () => {
    expect(judge("Lena Ortiz\n1990-04-12\nAdvanced Scuba Diver").verdict).toBe("match");
  });

  it("does not take a lower rating for a higher claim", () => {
    const result = judge("Lena Ortiz\n1990-04-12\nScuba Diver", { level: "advanced_open_water" });
    expect(result.verdict).toBe("level_unconfirmed");
  });

  it("never matches a level named in the site's menus, far from the diver", () => {
    const page = [
      "Courses",
      "Scuba Diver",
      "Advanced Scuba Diver",
      "Results",
      "Lena Ortiz",
      "1990-04-12",
      "Skin Diver",
    ].join("\n");
    expect(judge(page).verdict).toBe("level_unconfirmed");
  });

  it("matches whole words only", () => {
    expect(judge("Lenaya Ortizano\n1990-04-12\nScuba Diver").verdict).toBe("unreadable");
    expect(judge("Lena Ortiz\n1990-04-12\nScuba Diverse Program").verdict).toBe(
      "level_unconfirmed",
    );
  });

  it.each([
    "Junior Scuba Diver",
    "Scuba Diver (Referral)",
    "Scuba Diver - student",
    "Supervised Scuba Diver",
    "Passport Scuba Diver",
    "Scuba Diver: pending",
    "Scuba Diver revoked",
    "Scuba Diver (restricted)",
    "Scuba Diver eLearning",
  ])("never matches a limited or unfinished rating: %s", (line) => {
    expect(judge(`Lena Ortiz\n1990-04-12\n${line}`).verdict).toBe("level_unconfirmed");
  });

  it("reads a limiting word anywhere in the record, not only on the level's line", () => {
    expect(judge("Lena Ortiz\n1990-04-12\nScuba Diver\nJunior").verdict).toBe("level_unconfirmed");
  });

  it("leaves a row that names a trainer's title to a staffer", () => {
    expect(
      judge("Lena Ortiz\nCard GUE-1\nRecreational Diver 1 Instructor", {
        agency: "gue",
        cardNumber: "GUE-1",
      }).verdict,
    ).toBe("level_unconfirmed");
  });

  it.each(["divemaster", "instructor"] as const)(
    "never matches %s, whose title is also the trainer's",
    (level) => {
      expect(judge("Lena Ortiz\nCard N-12345\nDivemaster", { agency: "ssi", level }).verdict).toBe(
        "level_unconfirmed",
      );
    },
  );

  it("reads 'no results' as no record, even beside an echo of the search", () => {
    expect(judge("Verify Diver Certification\nNo results found.")).toEqual({
      verdict: "no_record",
    });
    expect(judge("Results for Lena Ortiz\nNo results found\nScuba Diver")).toEqual({
      verdict: "no_record",
    });
  });

  it("calls a page with neither a diver nor a 'no results' line unreadable", () => {
    expect(judge("Please complete the captcha")).toEqual({ verdict: "unreadable" });
    expect(judge("")).toEqual({ verdict: "unreadable" });
  });

  it("uses each agency's own wording", () => {
    expect(
      judge("Lena Ortiz\nN-12345\nStress & Rescue", { agency: "ssi", level: "rescue" }).verdict,
    ).toBe("match");
    expect(
      judge("Lena Ortiz\n1990-04-12\nAdvanced Adventure Diver", {
        agency: "sdi",
        level: "advanced_open_water",
      }).verdict,
    ).toBe("match");
    expect(
      judge("Lena Ortiz\nGUE-1\nRecreational Diver 1", { agency: "gue", cardNumber: "GUE-1" })
        .verdict,
    ).toBe("match");
    // NAUI's "Scuba Diver" is not SSI's open water wording.
    expect(judge("Lena Ortiz\nN-12345\nScuba Diver", { agency: "ssi" }).verdict).toBe(
      "level_unconfirmed",
    );
  });

  it("never matches a level the agency's row leaves out", () => {
    expect(
      judge("Lena Ortiz\nGUE-1\nRescue Diver", {
        agency: "gue",
        level: "rescue",
        cardNumber: "GUE-1",
      }).verdict,
    ).toBe("level_unconfirmed");
  });

  it("keeps the evidence to the diver's own record, and short", () => {
    const result = judge(
      `Someone Else 1970-01-01\nLena Ortiz ${"x".repeat(400)}\n1990-04-12\nScuba Diver`,
    );
    expect(result.verdict).toBe("match");
    if (result.verdict === "match") {
      expect(result.evidence).not.toContain("Someone Else");
      expect(result.evidence.length).toBeLessThanOrEqual(EVIDENCE_MAX_LENGTH);
      expect(result.evidence.endsWith("…")).toBe(true);
    }
  });

  it("reads no further than the page-text ceiling", () => {
    const padding = `${"filler line\n".repeat(5000)}`;
    expect(judge(`${padding}Lena Ortiz\n1990-04-12\nScuba Diver`).verdict).toBe("unreadable");
  });
});

/**
 * **PADI DiveChek** (layer 2 of the cert-check extension's second round). The
 * page sits behind the shop's own PADI Pro sign-in and nobody has seen it yet
 * (#2259), so these stand-ins are a best guess at its shape. What they pin is
 * the rule, which is the same as every agency's and narrower: name, birth date
 * and PADI's own words for the level in one record, and only one record.
 */
describe("judgeAgencyPage on PADI DiveChek", () => {
  const padi = (pageText: string, overrides: Partial<Parameters<typeof judgeAgencyPage>[0]> = {}) =>
    judge(pageText, { agency: "padi", cardNumber: null, ...overrides });
  const DIVECHEK = [
    "DiveChek",
    "1 diver found",
    "Lena Ortiz",
    "Date of Birth: 12 Apr 1990",
    "Open Water Diver 15 Jun 2015 1506AB1234",
  ].join("\n");

  it("certifies the one diver with this name and birth date at the claimed level", () => {
    expect(padi(DIVECHEK)).toEqual({
      verdict: "match",
      evidence: "Lena Ortiz · Date of Birth: 12 Apr 1990 · Open Water Diver 15 Jun 2015 1506AB1234",
    });
  });

  it("never certifies a namesake with another birth date", () => {
    expect(padi(DIVECHEK.replace("12 Apr 1990", "3 Sep 1987")).verdict).toBe("level_unconfirmed");
  });

  it("never certifies from a page listing several divers by this name, even when one is right", () => {
    const page = [
      "DiveChek",
      "Lena Ortiz",
      "Date of Birth: 12 Apr 1990",
      "Open Water Diver 15 Jun 2015",
      "Lena Ortiz",
      "Date of Birth: 3 Sep 1987",
      "Advanced Open Water Diver 2 Feb 2020",
    ].join("\n");
    expect(padi(page)).toEqual({ verdict: "several_records" });
    expect(padi(page, { level: "advanced_open_water" })).toEqual({ verdict: "several_records" });
  });

  it("never certifies from a page that says it found several divers", () => {
    const page = [
      "DiveChek",
      "2 divers found",
      "Lena Ortiz 12 Apr 1990",
      "Open Water Diver",
      "Mark Lee 3 May 1985",
      "Advanced Open Water Diver",
    ].join("\n");
    expect(padi(page)).toEqual({ verdict: "several_records" });
    expect(padi(page.replace("2 divers found", "Showing 2 results")).verdict).toBe(
      "several_records",
    );
  });

  it("never reads another level as the one claimed", () => {
    expect(padi(DIVECHEK, { level: "advanced_open_water" }).verdict).toBe("level_unconfirmed");
    expect(padi(DIVECHEK, { level: "rescue" }).verdict).toBe("level_unconfirmed");
    expect(padi(DIVECHEK.replace("Open Water Diver", "Scuba Diver")).verdict).toBe(
      "level_unconfirmed",
    );
    expect(padi(DIVECHEK.replace("Open Water Diver", "Junior Open Water Diver")).verdict).toBe(
      "level_unconfirmed",
    );
  });

  it("takes PADI's higher rating for the lower claim, never the other way", () => {
    const advanced = DIVECHEK.replace("Open Water Diver", "Advanced Open Water Diver");
    expect(padi(advanced).verdict).toBe("match");
    expect(padi(advanced, { level: "advanced_open_water" }).verdict).toBe("match");
    expect(
      padi(DIVECHEK.replace("Open Water Diver", "Rescue Diver"), { level: "rescue" }).verdict,
    ).toBe("match");
  });

  it("never certifies a professional rating", () => {
    expect(padi(DIVECHEK, { level: "divemaster" }).verdict).toBe("level_unconfirmed");
  });

  it("reads a sign-in page as unreadable, never as a result", () => {
    expect(padi("PADI Pros’ Site\nSign in\nEmail\nPassword\nForgot your password?").verdict).toBe(
      "unreadable",
    );
  });

  it("reads DiveChek's 'no results' as no record", () => {
    expect(padi("DiveChek\nNo results found for Lena Ortiz").verdict).toBe("no_record");
  });
});
