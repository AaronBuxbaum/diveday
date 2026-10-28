import { describe, expect, it } from "vitest";
import {
  AGENCY_CHECKS,
  type AgencyListedKind,
  agencyCheckQuery,
  agencyListedCards,
  EVIDENCE_MAX_LENGTH,
  foldText,
  isAgencyCheckableLevel,
  isCheckableAgency,
  judgeAgencyPage,
  LISTED_CARD_WORDING,
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
  return judgeAgencyPage({
    agency: "naui",
    level: "open_water",
    ...lena,
    today: "2026-10-14",
    pageText,
    ...overrides,
  });
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
      birthDate: "1990-04-12",
      cardNumber: "N-12345",
    });
  });

  /**
   * The query crosses to the extension and is typed into a third party's page:
   * a diver's birth date never goes to an agency that looks up by number, nor
   * a card number to one that looks up by birth date. CMAS takes either.
   */
  it("hands the extension nothing the agency's form does not ask for", () => {
    for (const agency of ["gue"] as const) {
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
    for (const agency of ["gue"] as const) {
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

  it("never checks a divemaster or instructor card, at any agency", () => {
    expect(isAgencyCheckableLevel("divemaster")).toBe(false);
    expect(isAgencyCheckableLevel("instructor")).toBe(false);
    for (const level of ["open_water", "advanced_open_water", "rescue"] as const) {
      expect(isAgencyCheckableLevel(level)).toBe(true);
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

  it.each([
    "04/12/1990",
    "4/12/1990",
    "1990-04-12",
    "April 12, 1990",
    "12 Apr 1990",
    "Apr 12 1990",
  ])("reads the birth date written as %s", (date) => {
    expect(judge(`Lena Ortiz\n${date}\nScuba Diver`).verdict).toBe("match");
  });

  /**
   * 12 April and 4 December are both "12/04" and "04/12" somewhere. A date
   * that could swap is read in the agency's own order only, so a transposed
   * birth date is another diver's.
   */
  it("reads a date that could swap in the agency's own order only", () => {
    expect(judge("Lena Ortiz\n12/04/1990\nScuba Diver").verdict).toBe("namesake");
    const cmas = { agency: "cmas", cardNumber: null } as const;
    expect(judge("Lena Ortiz\n12.04.1990\n1 Star Diver", cmas).verdict).toBe("match");
    expect(judge("Lena Ortiz\n04.12.1990\n1 Star Diver", cmas).verdict).toBe("namesake");
    // A day over 12 can be read only one way, whichever the agency writes.
    const later = { birthDate: "1990-04-15" } as const;
    expect(judge("Lena Ortiz\n15/04/1990\nScuba Diver", later).verdict).toBe("match");
    expect(judge("Lena Ortiz\n04/15/1990\nScuba Diver", later).verdict).toBe("match");
  });

  it("never matches without the birth date it searched by, so a namesake is not certified", () => {
    expect(judge("Lena Ortiz\nScuba Diver")).toEqual({ verdict: "namesake" });
    expect(judge("Lena Ortiz\n1985-07-01\nScuba Diver")).toEqual({ verdict: "namesake" });
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
    expect(judge("Lena Ortiz\nCard 99999999\nOpen Water Diver", ssi).verdict).toBe("namesake");
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

  it("reads a 'Last, First' name line as the diver's", () => {
    expect(judge("Ortiz, Lena\n1990-04-12\nScuba Diver").verdict).toBe("match");
    expect(judge("ORTIZ, Léna María\n04/12/1990\nScuba Diver").verdict).toBe("match");
    expect(judge("Ortiz, Lenara\n1990-04-12\nScuba Diver").verdict).toBe("unreadable");
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
  ])("never matches a limited or unfinished rating, and says so: %s", (line) => {
    expect(judge(`Lena Ortiz\n1990-04-12\n${line}`).verdict).toBe("limited_card");
  });

  it("reads a limiting word anywhere in the record, not only on the level's line", () => {
    expect(judge("Lena Ortiz\n1990-04-12\nScuba Diver\nJunior").verdict).toBe("limited_card");
  });

  it("leaves a public lookup's row that names a trainer's title to a staffer", () => {
    expect(
      judge("Lena Ortiz\nCard GUE-1\nRecreational Diver 1 Instructor", {
        agency: "gue",
        cardNumber: "GUE-1",
      }).verdict,
    ).toBe("limited_card");
  });

  it.each(["divemaster", "instructor"] as const)(
    "never matches %s, whose title is also the trainer's",
    (level) => {
      expect(
        judge("Lena Ortiz\nCard N-12345\nDivemaster", { agency: "ssi", level }).verdict,
      ).not.toBe("match");
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
    // The name line keeps only the diver's name: whatever else it says is not theirs.
    expect(result).toEqual({ verdict: "match", evidence: "Lena Ortiz · 1990-04-12 · Scuba Diver" });
    const long = judge(
      `Someone Else 1970-01-01\nLena Ortiz\n1990-04-12 ${"7".repeat(400)}\nScuba Diver`,
    );
    expect(long.verdict).toBe("match");
    if (long.verdict === "match") {
      expect(long.evidence).not.toContain("Someone Else");
      expect(long.evidence.length).toBeLessThanOrEqual(EVIDENCE_MAX_LENGTH);
      expect(long.evidence.endsWith("…")).toBe(true);
    }
  });

  it("keeps a match's name line to the diver's name, the certification's words, dates and numbers", () => {
    const row =
      "Lena Ortiz 12 Apr 1990 Rescue Diver 3 Mar 2021 Instructor Sam Hill #123456 Reef Divers Ltd";
    expect(judge(row, { agency: "padi", level: "rescue", cardNumber: null })).toEqual({
      verdict: "match",
      evidence: "Lena Ortiz 12 Apr 1990 Rescue Diver 3 Mar 2021 #123456",
    });
  });

  it("reads no further than the page-text ceiling", () => {
    const padding = `${"filler line\n".repeat(5000)}`;
    expect(judge(`${padding}Lena Ortiz\n1990-04-12\nScuba Diver`).verdict).toBe("unreadable");
  });
});

/**
 * **PADI DiveChek** (H-121). The page sits behind the shop's own PADI Pro
 * sign-in and nobody has seen it yet (#2259), so these stand-ins are a best
 * guess at its shape. What they pin is the rule, which is every agency's and
 * narrower: one diver, a record that ends at the first line that could be
 * someone else's, the birth date before the level, the card number when the
 * card has one, and PADI's own words for the level.
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

  it("says a namesake with another birth date is not this diver, and keeps none of their words", () => {
    expect(padi(DIVECHEK.replace("12 Apr 1990", "3 Sep 1987"))).toEqual({ verdict: "namesake" });
  });

  it("reads a transposed birth date as another diver's", () => {
    // PADI writes month first: 12/04/1990 is 4 December.
    expect(padi(DIVECHEK.replace("12 Apr 1990", "12/04/1990"))).toEqual({ verdict: "namesake" });
    expect(padi(DIVECHEK.replace("12 Apr 1990", "04/12/1990")).verdict).toBe("match");
  });

  /** Security review S1: the row under this diver's may be a neighbour's. */
  it("never reads a neighbour's row as this diver's", () => {
    const page = [
      "Lena Ortiz",
      "Date of Birth: 12 Apr 1990",
      "Scuba Diver",
      "Mark Lee",
      "Open Water Diver",
    ].join("\n");
    const result = padi(page);
    expect(result.verdict).not.toBe("match");
    expect(JSON.stringify(result)).not.toContain("Mark Lee");
    expect(JSON.stringify(result)).not.toContain("Open Water");
  });

  it("ends the record at another diver's name and birth date, and keeps only this diver's words", () => {
    const page = [
      "Lena Ortiz 12 Apr 1990",
      "Open Water Diver 15 Jun 2015",
      "Mark Lee 3 May 1985",
      "Advanced Open Water Diver 2 Feb 2020",
    ].join("\n");
    expect(padi(page, { level: "advanced_open_water" }).verdict).toBe("level_unconfirmed");
    const result = padi(page);
    expect(result).toEqual({
      verdict: "match",
      evidence: "Lena Ortiz 12 Apr 1990 · Open Water Diver 15 Jun 2015",
    });
  });

  it("needs the birth date before the level", () => {
    expect(padi("Lena Ortiz\nOpen Water Diver\nDate of Birth: 12 Apr 1990").verdict).not.toBe(
      "match",
    );
  });

  /** Domain review D2: DiveChek may list one row per certification. */
  it("reads several certifications under one name and birth date as one diver's", () => {
    const grouped = [
      "Lena Ortiz",
      "Date of Birth: 12 Apr 1990",
      "Open Water Diver 15 Jun 2015",
      "Advanced Open Water Diver 2 Feb 2020",
      "Rescue Diver 3 Mar 2021",
    ].join("\n");
    expect(padi(grouped, { level: "rescue" }).verdict).toBe("match");

    const rows = [
      "3 results",
      "Lena Ortiz 12 Apr 1990 Open Water Diver 15 Jun 2015",
      "Lena Ortiz 12 Apr 1990 Advanced Open Water Diver 2 Feb 2020",
      "Lena Ortiz 12 Apr 1990 Rescue Diver 3 Mar 2021",
    ].join("\n");
    expect(padi(rows, { level: "rescue" })).toEqual({
      verdict: "match",
      evidence: "Lena Ortiz 12 Apr 1990 Rescue Diver 3 Mar 2021",
    });
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
  });

  it("needs the card number in the record when the card has one", () => {
    expect(padi(DIVECHEK, { cardNumber: "1506AB1234" }).verdict).toBe("match");
    expect(padi(DIVECHEK, { cardNumber: "1506-ab-1234" }).verdict).toBe("match");
    expect(padi(DIVECHEK, { cardNumber: "9999ZZ0000" }).verdict).toBe("level_unconfirmed");
  });

  it("never reads another level as the one claimed", () => {
    expect(padi(DIVECHEK, { level: "advanced_open_water" }).verdict).toBe("level_unconfirmed");
    expect(padi(DIVECHEK, { level: "rescue" }).verdict).toBe("level_unconfirmed");
    expect(padi(DIVECHEK.replace("Open Water Diver", "Scuba Diver")).verdict).toBe(
      "level_unconfirmed",
    );
  });

  /** Domain review D3: a DiveChek row names the instructor who certified the card. */
  it("reads an instructor named on the row as the trainer, not as a limit", () => {
    const page = [
      "Lena Ortiz",
      "Date of Birth: 12 Apr 1990",
      "Open Water Diver 15 Jun 2015 Instructor #123456 Dive Center XYZ",
    ].join("\n");
    expect(padi(page).verdict).toBe("match");
  });

  it("still refuses a limited or unfinished rating, and says so", () => {
    expect(padi(DIVECHEK.replace("Open Water Diver", "Open Water Diver (Referral)")).verdict).toBe(
      "limited_card",
    );
    expect(padi(DIVECHEK.replace("Open Water Diver", "Open Water Diver eLearning")).verdict).toBe(
      "limited_card",
    );
  });

  /** Domain review D5: PADI's junior ratings become the full rating at 15. */
  it("takes a Junior rating as the level for a diver 15 or older on the day of the check", () => {
    const junior = DIVECHEK.replace("Open Water Diver", "Junior Open Water Diver");
    expect(padi(junior).verdict).toBe("match");
    const turned15Today = junior.replace("12 Apr 1990", "14 Oct 2011");
    expect(padi(turned15Today, { birthDate: "2011-10-14" }).verdict).toBe("match");
  });

  it("leaves a Junior rating under 15 to be recorded by hand", () => {
    const junior = DIVECHEK.replace("12 Apr 1990", "15 Oct 2011").replace(
      "Open Water Diver",
      "Junior Open Water Diver",
    );
    expect(padi(junior, { birthDate: "2011-10-15" })).toEqual({
      verdict: "junior_under_15",
      evidence:
        "Lena Ortiz · Date of Birth: 15 Oct 2011 · Junior Open Water Diver 15 Jun 2015 1506AB1234",
    });
    // A bare "Junior", not the level's own words, is a limit at any age.
    expect(padi(DIVECHEK.replace("1506AB1234", "Junior")).verdict).toBe("limited_card");
  });

  it("reads a 'Last, First' name line", () => {
    expect(padi(DIVECHEK.replace("Lena Ortiz", "Ortiz, Lena")).verdict).toBe("match");
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

/**
 * **The other cards the agency's page lists** (layer 3). After a match the
 * same page may show the diver's nitrox and specialty cards; these are offered
 * to the staffer as pending cards. The adversarial cases are the point: a
 * neighbour's cards, a card the diver already holds, wording nobody put in the
 * table, and a page that never matched.
 */
describe("agencyListedCards", () => {
  const listed = (
    pageText: string,
    overrides: Partial<Parameters<typeof agencyListedCards>[0]> = {},
  ) =>
    agencyListedCards({
      agency: "ssi",
      level: "open_water",
      ...lena,
      birthDate: null,
      today: "2026-10-14",
      pageText,
      held: new Set<AgencyListedKind>(),
      ...overrides,
    });
  const kinds = (cards: ReturnType<typeof agencyListedCards>) => cards.map((card) => card.kind);
  const SSI = [
    "Online Diver Check",
    "Lena Ortiz",
    "Card N-12345",
    "Open Water Diver",
    "Enriched Air Nitrox 32 · 12.05.2021",
    "Deep Diving",
  ].join("\n");
  const SSI_EVIDENCE =
    "Lena Ortiz · Card N-12345 · Open Water Diver · Enriched Air Nitrox 32 · 12.05.2021 · Deep Diving";

  it("offers the nitrox and specialty cards listed in the diver's own record, in the agency's words", () => {
    expect(listed(SSI)).toEqual([
      { kind: "nitrox", words: "Enriched Air Nitrox", evidence: SSI_EVIDENCE, cardNumber: null },
      { kind: "deep", words: "Deep Diving", evidence: SSI_EVIDENCE, cardNumber: null },
    ]);
  });

  it("keeps the name line to the diver's name in a listed card's words", () => {
    const page = SSI.replace("Lena Ortiz", "Lena Ortiz (referred by Mark Lee)");
    const cards = listed(page);
    expect(kinds(cards)).toEqual(["nitrox", "deep"]);
    expect(cards[0]?.evidence).toBe(SSI_EVIDENCE);
  });

  /** Each agency's wording, held to the words its page prints (D4 of the layer 3 review). */
  it.each([
    ["ssi", "Night & Limited Visibility Diving", "night"],
    ["ssi", "Night and Limited Visibility Diving", "night"],
    ["naui", "Wreck Diver (External Survey)", "wreck"],
    ["naui", "Wreck Diver", "wreck"],
  ] as const)("reads %s's %s as %s", (agency, line, kind) => {
    const record = ["Lena Ortiz 04/12/1990", "Card N-12345", "Open Water Diver", line].join("\n");
    expect(kinds(listed(record, { agency, birthDate: "1990-04-12" }))).toEqual([kind]);
  });

  it.each([
    ["ssi", "Enriched Air Nitrox Instructor"],
    ["ssi", "Night Diving & Limited Visibility"],
    ["naui", "Wreck Penetration Diver"],
  ] as const)("does not read %s's %s", (agency, line) => {
    const record = ["Lena Ortiz 04/12/1990", "Card N-12345", "Open Water Diver", line].join("\n");
    expect(listed(record, { agency, birthDate: "1990-04-12" })).toEqual([]);
  });

  it("reads GUE's nitrox from Recreational Diver 1, which bundles it, on the diver's own number", () => {
    const gue = ["Lena Ortiz", "GUE-4411", "Recreational Diver 1"].join("\n");
    expect(
      listed(gue, { agency: "gue", cardNumber: "GUE-4411" }).map((card) => [
        card.kind,
        card.words,
        card.cardNumber,
      ]),
    ).toEqual([["nitrox", "Recreational Diver 1", null]]);
    expect(
      listed(gue, {
        agency: "gue",
        cardNumber: "GUE-4411",
        held: new Set<AgencyListedKind>(["nitrox"]),
      }),
    ).toEqual([]);
  });

  /**
   * SDI and CMAS number each card (D2), so a listed card takes the number on
   * its own line, never the checked card's; with none, or with two, it has
   * none and is confirmed through the sighting.
   */
  describe("where the agency numbers each card", () => {
    const sdi = (...lines: string[]) =>
      listed(["Lena Ortiz 04/12/1990", "Open Water Scuba Diver #SDI-1001", ...lines].join("\n"), {
        agency: "sdi",
        birthDate: "1990-04-12",
        cardNumber: "SDI-1001",
      }).map((card) => [card.kind, card.cardNumber]);

    it("takes the number printed on the card's own line", () => {
      expect(sdi("Computer Nitrox Diver 03/02/2019 #SDI-2002", "Deep Diver 778899")).toEqual([
        ["nitrox", "SDI-2002"],
        ["deep", "778899"],
      ]);
    });

    it("takes none when the line shows none, two, or only the checked card's", () => {
      expect(sdi("Computer Nitrox Diver 03/02/2019")).toEqual([["nitrox", null]]);
      expect(sdi("Computer Nitrox Diver 778899 / 991122")).toEqual([["nitrox", null]]);
      expect(sdi("Computer Nitrox Diver SDI-1001")).toEqual([["nitrox", null]]);
      // Two cards on one line: whose number it is, nobody can say.
      expect(sdi("Deep Diver · Wreck Diver 778899").sort()).toEqual([
        ["deep", null],
        ["wreck", null],
      ]);
    });

    it("never takes a number where the agency numbers the diver", () => {
      const record = ["Lena Ortiz", "Card N-12345", "Open Water Diver", "Deep Diving 778899"];
      expect(listed(record.join("\n")).map((card) => card.cardNumber)).toEqual([null]);
    });
  });

  /**
   * A recreational card DiveDay holds no kind for neither offers nor ends the
   * record (D3), so the cards under it are still read. Anything else still ends it.
   */
  it.each([
    ["ssi", "Perfect Buoyancy"],
    ["ssi", "Navigation 03.04.2020"],
    ["ssi", "Scuba Diver"],
    ["naui", "Skin Diver"],
  ] as const)("passes over %s's %s and reads on", (agency, line) => {
    const deep = { ssi: "Deep Diving", naui: "Deep Diver" }[agency];
    const record = ["Lena Ortiz 04/12/1990", "Card N-12345", "Open Water Diver", line, deep];
    expect(kinds(listed(record.join("\n"), { agency, birthDate: "1990-04-12" }))).toEqual(["deep"]);
  });

  it("still ends the record at a technical or professional rating after a pass-over", () => {
    const record = [
      "Lena Ortiz",
      "Card N-12345",
      "Open Water Diver",
      "Perfect Buoyancy",
      "Tec Navigation",
      "Deep Diving",
    ];
    expect(listed(record.join("\n"))).toEqual([]);
  });

  it("offers nothing without a match", () => {
    expect(listed(SSI.replace("Open Water Diver", "Scuba Skills Update"))).toEqual([]);
    expect(listed(SSI, { cardNumber: "N-99999" })).toEqual([]);
    expect(listed("No results found")).toEqual([]);
  });

  it("never offers a neighbour's cards", () => {
    // A neighbour's bare name ends the record: nothing after it is read.
    const neighbour = [
      "Lena Ortiz",
      "Card N-12345",
      "Open Water Diver",
      "Mark Lee",
      "Enriched Air Nitrox",
    ].join("\n");
    expect(listed(neighbour)).toEqual([]);
    // Nor a neighbour's name and card on one line, or anything under it.
    const oneLine = [
      "Lena Ortiz",
      "Card N-12345",
      "Open Water Diver",
      "Mark Lee Deep Diving",
      "Wreck Diving",
    ].join("\n");
    expect(listed(oneLine)).toEqual([]);
    expect(JSON.stringify(listed(oneLine))).not.toContain("Mark Lee");
    // Nor a neighbour's birth date and the cards under it.
    const naui = [
      "Lena Ortiz 04/12/1990",
      "Advanced Scuba Diver",
      "03/09/1987",
      "Night Diver",
    ].join("\n");
    expect(listed(naui, { agency: "naui", birthDate: "1990-04-12" })).toEqual([]);
  });

  it("reads only the records that carry this diver's birth date, never a namesake's", () => {
    const page = [
      "Lena Ortiz",
      "09/03/1987",
      "Deep Diver",
      "Lena Ortiz",
      "04/12/1990",
      "Scuba Diver",
      "Night Diver",
    ].join("\n");
    expect(kinds(listed(page, { agency: "naui", birthDate: "1990-04-12" }))).toEqual(["night"]);
  });

  it("never offers a card the diver already holds", () => {
    expect(kinds(listed(SSI, { held: new Set<AgencyListedKind>(["nitrox"]) }))).toEqual(["deep"]);
    expect(listed(SSI, { held: new Set<AgencyListedKind>(["nitrox", "deep"]) })).toEqual([]);
  });

  it("ignores wording that is not in the agency's table, rather than guessing", () => {
    const unknown = (line: string) =>
      listed(["Lena Ortiz", "Card N-12345", "Open Water Diver", line].join("\n"));
    // Another agency's words, a technical or professional rating, a card DiveDay has no kind for.
    for (const line of [
      "Enriched Air Diver",
      "Advanced Nitrox",
      "Enriched Air Nitrox Instructor",
      "Deep Diving Instructor",
      "Tec Deep Diving",
      "Sidemount Diving",
      "Nitrox",
    ]) {
      expect(unknown(line), line).toEqual([]);
    }
  });

  it("reads no further than the first line it cannot explain", () => {
    const page = [
      "Lena Ortiz",
      "Card N-12345",
      "Open Water Diver",
      "Freediver Level 2",
      "Deep Diving",
    ].join("\n");
    expect(listed(page)).toEqual([]);
  });

  it("offers nothing from a limited or unfinished record", () => {
    // DiveChek's row for one card says it is revoked: that row offers nothing.
    const rows = [
      "Lena Ortiz 12 Apr 1990 Open Water Diver 15 Jun 2015",
      "Lena Ortiz 12 Apr 1990 Enriched Air Diver Revoked",
    ].join("\n");
    expect(listed(rows, { agency: "padi", cardNumber: null, birthDate: "1990-04-12" })).toEqual([]);
    expect(listed(SSI.replace("Deep Diving", "Deep Diving (in progress)"))).toEqual([]);
  });

  describe("on PADI DiveChek", () => {
    const padi = (
      pageText: string,
      overrides: Partial<Parameters<typeof agencyListedCards>[0]> = {},
    ) =>
      listed(pageText, { agency: "padi", cardNumber: null, birthDate: "1990-04-12", ...overrides });

    it("reads one row per certification, and the instructor named after a card's date", () => {
      const rows = [
        "1 diver found",
        "Lena Ortiz 12 Apr 1990 Open Water Diver 15 Jun 2015 Instructor #123456 Dive Center XYZ",
        "Lena Ortiz 12 Apr 1990 Enriched Air Diver 2 Feb 2020 Instructor #123456 Dive Center XYZ",
        "Lena Ortiz 12 Apr 1990 Dry Suit Diver 3 Mar 2021",
      ].join("\n");
      expect(padi(rows).map((card) => [card.kind, card.words])).toEqual([
        ["nitrox", "Enriched Air Diver"],
        ["drysuit", "Dry Suit Diver"],
      ]);
    });

    it("reads a card listed under the diver's name and birth date", () => {
      const grouped = [
        "Lena Ortiz",
        "Date of Birth: 12 Apr 1990",
        "Open Water Diver 15 Jun 2015",
        "Enriched Air Diver 2 Feb 2020",
        "Cavern Diver",
      ].join("\n");
      expect(kinds(padi(grouped))).toEqual(["nitrox", "cavern"]);
    });

    it("never reads a professional rating as the diver's card", () => {
      const pro = [
        "Lena Ortiz",
        "Date of Birth: 12 Apr 1990",
        "Open Water Diver 15 Jun 2015",
        "Deep Diver Instructor",
        "Wreck Diver",
      ].join("\n");
      expect(padi(pro)).toEqual([]);
    });

    it("reads PADI's 'Specialty' after a specialty's name, never before a trainer's word", () => {
      const grouped = (line: string) =>
        padi(
          [
            "Lena Ortiz",
            "Date of Birth: 12 Apr 1990",
            "Open Water Diver 15 Jun 2015",
            line,
            "Wreck Diver",
          ].join("\n"),
        );
      expect(kinds(grouped("Deep Diver Specialty 2 Feb 2020"))).toEqual(["deep", "wreck"]);
      expect(grouped("Deep Diver Specialty Instructor")).toEqual([]);
    });

    it("passes over a dated recreational card it holds no kind for, and reads on", () => {
      const grouped = [
        "Lena Ortiz",
        "Date of Birth: 12 Apr 1990",
        "Open Water Diver 15 Jun 2015",
        "Peak Performance Buoyancy 2 Feb 2020",
        "Enriched Air Diver 4 Apr 2021",
      ].join("\n");
      expect(kinds(padi(grouped))).toEqual(["nitrox"]);
    });

    it("offers nothing when DiveChek lists several divers", () => {
      const page = [
        "Lena Ortiz",
        "Date of Birth: 12 Apr 1990",
        "Open Water Diver",
        "Lena Ortiz",
        "Date of Birth: 3 Sep 1987",
        "Enriched Air Diver",
      ].join("\n");
      expect(padi(page)).toEqual([]);
    });
  });

  it("holds a closed table for every agency the extension checks, never a level's own words", () => {
    expect(Object.keys(LISTED_CARD_WORDING).sort()).toEqual(Object.keys(AGENCY_CHECKS).sort());
    for (const words of Object.values(LISTED_CARD_WORDING)) {
      for (const phrase of Object.values(words).flat()) {
        expect(foldText(phrase)).not.toMatch(/instructor|junior|tec /);
      }
    }
  });
});
