import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { NO_REQUIREMENT } from "@/lib/requirement";
import { admissionDisplay } from "./admission-display";

const t = staffTranslator("en-US");

describe("admissionDisplay", () => {
  it("shows the live course card and age even with no trip requirement", () => {
    expect(
      admissionDisplay(
        { minimumCertificationLevel: "advanced_open_water", minimumAge: 15 },
        null,
        null,
        t,
      ),
    ).toMatch(/Verified Advanced Open Water.*Minimum age 15/);
  });

  it("says anyone when the applicable rule is unrestricted", () => {
    expect(admissionDisplay(null, null, null, t)).toBe("Anyone");
    expect(
      admissionDisplay({ minimumCertificationLevel: null, minimumAge: null }, null, null, t),
    ).toBe("Anyone");
  });

  it("combines non-course trip and site gates, including specialties without a level", () => {
    expect(
      admissionDisplay(
        null,
        {
          ...NO_REQUIREMENT,
          minimumCertificationLevel: "open_water",
          requiredSpecialties: ["deep"],
        },
        {
          ...NO_REQUIREMENT,
          minimumCertificationLevel: "advanced_open_water",
          requiresNitrox: true,
        },
        t,
      ),
    ).toMatch(/Advanced Open Water.*Deep.*Nitrox/);
    expect(
      admissionDisplay(null, { ...NO_REQUIREMENT, requiredSpecialties: ["deep"] }, null, t),
    ).toMatch(/Deep/);
  });

  it("does not add trip or site certification gates to a course's rule", () => {
    expect(
      admissionDisplay(
        { minimumCertificationLevel: null, minimumAge: 12 },
        { ...NO_REQUIREMENT, minimumCertificationLevel: "rescue", requiredSpecialties: ["deep"] },
        { ...NO_REQUIREMENT, requiresNitrox: true },
        t,
      ),
    ).toBe("Minimum age 12 (staff check known dates of birth)");
  });
});
