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

const lena = { firstName: "Lena", lastName: "Ortiz" } as const;

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

  it("types the first and last words of the name, with the birth date and number", () => {
    expect(agencyCheckQuery(base)).toEqual({
      agency: "naui",
      firstName: "Lena",
      lastName: "Ortiz",
      birthDate: "1990-04-12",
      cardNumber: "N-12345",
    });
  });

  it("checks nothing for an agency with no public lookup, or for PADI's member sign-in", () => {
    for (const agency of ["padi", "raid", "bsac", "iantd", "nss_cds", "nacd", "other"] as const) {
      expect(agencyCheckQuery({ ...base, agency })).toBeNull();
    }
  });

  it("needs a birth date where the form asks for one", () => {
    for (const agency of ["naui", "sdi", "tdi"] as const) {
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
      expect(page?.kind).not.toBe("member_sign_in");
      expect(page).toBeDefined();
    }
  });
});

describe("foldText", () => {
  it("drops accents, case and punctuation", () => {
    expect(foldText("  ZOË  O'Brien-Smith ")).toBe("zoe o brien smith");
    expect(foldText("Stress & Rescue")).toBe("stress & rescue");
  });
});

describe("judgeAgencyPage", () => {
  it("matches the diver's name and the claimed level in one result", () => {
    const result = judge(
      [
        "Verify Diver Certification",
        "Name: Lena Ortiz",
        "Date of birth: 1990-04-12",
        "Certification: Scuba Diver",
        "Issued: 2019-03-02",
      ].join("\n"),
    );
    expect(result).toEqual({
      verdict: "match",
      evidence:
        "Verify Diver Certification · Name: Lena Ortiz · Date of birth: 1990-04-12 · Certification: Scuba Diver · Issued: 2019-03-02",
    });
  });

  it("ignores accents and case on both sides", () => {
    const result = judge("LENA ORTÍZ\nopen water diver", { lastName: "Ortiz" });
    expect(result.verdict).toBe("match");
  });

  it("takes a higher rating's wording as the lower one it contains", () => {
    expect(judge("Lena Ortiz\nAdvanced Scuba Diver").verdict).toBe("match");
  });

  it("does not take a lower rating for a higher claim", () => {
    const result = judge("Lena Ortiz\nScuba Diver", { level: "advanced_open_water" });
    expect(result.verdict).toBe("level_unconfirmed");
  });

  it("never matches a level named in the site's menus, far from the diver", () => {
    const page = [
      "Courses",
      "Scuba Diver",
      "Advanced Scuba Diver",
      "Rescue Scuba Diver",
      "About NAUI",
      "Shop",
      "Contact",
      "Results",
      "Lena Ortiz",
      "1990-04-12",
      "Skin Diver",
    ].join("\n");
    expect(judge(page).verdict).toBe("level_unconfirmed");
  });

  it("matches whole words only", () => {
    expect(judge("Lenaya Ortizano\nScuba Diver").verdict).toBe("unreadable");
    expect(judge("Lena Ortiz\nScuba Diverse Program").verdict).toBe("level_unconfirmed");
  });

  it("needs the first name as well as the last", () => {
    expect(judge("Maria Ortiz\nScuba Diver").verdict).toBe("unreadable");
  });

  it.each([
    "Junior Scuba Diver",
    "Scuba Diver (Referral)",
    "Scuba Diver - student",
    "Supervised Scuba Diver",
    "Passport Scuba Diver",
    "Scuba Diver: pending",
    "Scuba Diver revoked",
  ])("never matches a limited or unfinished rating: %s", (line) => {
    expect(judge(`Lena Ortiz\n${line}`).verdict).toBe("level_unconfirmed");
  });

  it.each(["divemaster", "instructor"] as const)(
    "never matches %s, whose title is also the trainer's",
    (level) => {
      expect(
        judge("Lena Ortiz\nDivemaster\nInstructor: Sam Reyes", { agency: "ssi", level }).verdict,
      ).toBe("level_unconfirmed");
    },
  );

  it("does not match a level beside a 'no results' line that echoes the search", () => {
    const page = "Results for Lena Ortiz\nNo results found\nScuba Diver";
    expect(judge(page).verdict).toBe("level_unconfirmed");
  });

  it("reads 'no results' as no record, never as a failed card", () => {
    expect(judge("Verify Diver Certification\nNo results found.")).toEqual({
      verdict: "no_record",
    });
  });

  it("calls a page with neither a diver nor a 'no results' line unreadable", () => {
    expect(judge("Please complete the captcha")).toEqual({ verdict: "unreadable" });
    expect(judge("")).toEqual({ verdict: "unreadable" });
  });

  it("uses each agency's own wording", () => {
    expect(judge("Lena Ortiz\nStress & Rescue", { agency: "ssi", level: "rescue" }).verdict).toBe(
      "match",
    );
    expect(
      judge("Lena Ortiz\nAdvanced Adventure Diver", { agency: "sdi", level: "advanced_open_water" })
        .verdict,
    ).toBe("match");
    expect(
      judge("Lena Ortiz\n2-Star Diver", { agency: "cmas", level: "advanced_open_water" }).verdict,
    ).toBe("match");
    expect(
      judge("Lena Ortiz\nRecreational Diver 1", { agency: "gue", level: "open_water" }).verdict,
    ).toBe("match");
    // NAUI's "Scuba Diver" is not SSI's open water wording.
    expect(judge("Lena Ortiz\nScuba Diver", { agency: "ssi" }).verdict).toBe("level_unconfirmed");
  });

  it("never matches a level the agency's row leaves out", () => {
    expect(judge("Lena Ortiz\nRescue Diver", { agency: "gue", level: "rescue" }).verdict).toBe(
      "level_unconfirmed",
    );
  });

  it("keeps the evidence short", () => {
    const long = "x".repeat(400);
    const result = judge(`${long}\nLena Ortiz\nScuba Diver`);
    expect(result.verdict).toBe("match");
    if (result.verdict === "match") {
      expect(result.evidence.length).toBeLessThanOrEqual(EVIDENCE_MAX_LENGTH);
      expect(result.evidence.endsWith("…")).toBe(true);
    }
  });

  it("reads no further than the page-text ceiling", () => {
    const padding = `${"filler line\n".repeat(5000)}`;
    expect(judge(`${padding}Lena Ortiz\nScuba Diver`).verdict).toBe("unreadable");
  });
});
