import { describe, expect, it } from "vitest";
import { AGENCY_PAGE_FIXTURES } from "./__fixtures__/agency-pages";
import { judgeAgencyPage } from "./agency-check";

/**
 * The judge on each reachable agency's own page furniture (NAUI, SDI, CMAS,
 * GUE), with stand-in results where the page draws them by script. Where the
 * fixtures come from: `src/lib/__fixtures__/agency-pages.ts`.
 */
describe("judgeAgencyPage on the agencies' own pages", () => {
  it.each(AGENCY_PAGE_FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    "%s",
    (_, fixture) => {
      expect(
        judgeAgencyPage({ ...fixture.query, today: "2026-10-15", pageText: fixture.pageText })
          .verdict,
      ).toBe(fixture.expected);
    },
  );

  it("covers every agency whose lookup page is reachable without a person", () => {
    expect(new Set(AGENCY_PAGE_FIXTURES.map((fixture) => fixture.query.agency))).toEqual(
      new Set(["naui", "sdi", "cmas", "gue"]),
    );
  });

  it("never matches a fixture's own page with the diver's name changed", () => {
    for (const fixture of AGENCY_PAGE_FIXTURES) {
      const verdict = judgeAgencyPage({
        ...fixture.query,
        firstName: "Hana",
        today: "2026-10-15",
        pageText: fixture.pageText,
      });
      expect(verdict.verdict, fixture.name).not.toBe("match");
    }
  });
});
