import { describe, expect, it } from "vitest";
import { type AgencyListedKind, agencyListedCards, judgeAgencyPage } from "./agency-check";

/**
 * DiveChek cases from the domain reviews of 2026-10-15: PADI's short "Jr.",
 * a name over "No record was found.", and a same-name record under another
 * PADI number. `agency-check.test.ts` holds the rest of the judge.
 */
const lena = { firstName: "Lena", lastName: "Ortiz", birthDate: "1990-04-12" } as const;
const DIVECHEK = [
  "DiveChek",
  "1 diver found",
  "Lena Ortiz",
  "Date of Birth: 12 Apr 1990",
  "Open Water Diver 15 Jun 2015 1506AB1234",
].join("\n");

function padi(pageText: string, overrides: Partial<Parameters<typeof judgeAgencyPage>[0]> = {}) {
  return judgeAgencyPage({
    agency: "padi",
    level: "open_water",
    ...lena,
    cardNumber: null,
    today: "2026-10-14",
    pageText,
    ...overrides,
  });
}

describe("judgeAgencyPage on PADI DiveChek, after the domain reviews", () => {
  /** Domain review R4-3b: "Jr." is PADI's short word for Junior. */
  it("never reads a Jr. rating as the plain one for a diver under 15", () => {
    const junior = DIVECHEK.replace("12 Apr 1990", "15 Oct 2014").replace(
      "Open Water Diver",
      "Jr. Open Water Diver",
    );
    expect(padi(junior, { birthDate: "2014-10-15" }).verdict).toBe("junior_under_15");
    // 15 or older, a Jr. rating is the level, as Junior is.
    expect(padi(DIVECHEK.replace("Open Water Diver", "Jr. Open Water Diver")).verdict).toBe(
      "match",
    );
    // A bare "Jr", not the level's own words, is a limit at any age.
    expect(padi(DIVECHEK.replace("1506AB1234", "Jr")).verdict).toBe("limited_card");
  });

  /** Domain review R4 (adversarial) nit: the diver's line, then the page's "nobody found". */
  it("reads a name and birth date over 'No record was found.' as no record", () => {
    expect(padi("Lena Ortiz 04/12/1990\nNo record was found.")).toEqual({ verdict: "no_record" });
  });
});

describe("agencyListedCards on PADI DiveChek, after the domain reviews", () => {
  const listed = (pageText: string, cardNumber: string) =>
    agencyListedCards({
      agency: "padi",
      level: "open_water",
      ...lena,
      cardNumber,
      today: "2026-10-14",
      pageText,
      held: new Set<AgencyListedKind>(),
    });

  /** Domain review R4 (adversarial) 1: same name and birth date, another PADI number. */
  it("never offers a record carrying another PADI number than the card checked", () => {
    const page = [
      "DiveChek",
      "Lena Ortiz 04/12/1990 Open Water Diver 06/15/2015 1506AB1234",
      "Lena Ortiz 04/12/1990 Deep Diver 02/02/2020 1712CD5678",
    ].join("\n");
    expect(listed(page, "1506AB1234")).toEqual([]);
    // The same records under the number checked are offered.
    expect(
      listed(page.replace("1712CD5678", "1506AB1234"), "1506AB1234").map((card) => card.kind),
    ).toEqual(["deep"]);
  });
});
