import { describe, expect, it } from "vitest";
import { feetToMeters } from "./depth-units";
import { changedAdmissionFields, type DiveSiteAdmission } from "./dive-sites";

/**
 * **What a crew member may not change on a dive site** (issue #3706): the
 * level, specialties, nitrox and max depth. The detector is what the save
 * action refuses on, so a briefing posted back untouched must never read as a
 * change, and every loosening or tightening must.
 */
const stored: DiveSiteAdmission = {
  minimumCertificationLevel: "advanced_open_water",
  requiredSpecialties: ["wreck", "deep"],
  requiresNitrox: true,
  maxDepthMeters: feetToMeters(100),
};

describe("changedAdmissionFields", () => {
  it("sees nothing in a briefing posted back as the form showed it", () => {
    expect(changedAdmissionFields(stored, { ...stored }, "feet")).toEqual([]);
    // The form shows 100 ft and posts 100 ft back, whatever the stored metres.
    expect(
      changedAdmissionFields(stored, { ...stored, maxDepthMeters: feetToMeters(100) }, "feet"),
    ).toEqual([]);
  });

  it("reads the specialties as a set, not a list", () => {
    expect(
      changedAdmissionFields(stored, { ...stored, requiredSpecialties: ["deep", "wreck"] }, "feet"),
    ).toEqual([]);
  });

  it.each<[string, Partial<DiveSiteAdmission>, keyof DiveSiteAdmission]>([
    ["dropping the level", { minimumCertificationLevel: null }, "minimumCertificationLevel"],
    [
      "lowering the level",
      { minimumCertificationLevel: "open_water" },
      "minimumCertificationLevel",
    ],
    ["dropping a specialty", { requiredSpecialties: ["wreck"] }, "requiredSpecialties"],
    [
      "adding a specialty",
      { requiredSpecialties: ["wreck", "deep", "night"] },
      "requiredSpecialties",
    ],
    ["clearing the specialties", { requiredSpecialties: [] }, "requiredSpecialties"],
    ["turning nitrox off", { requiresNitrox: false }, "requiresNitrox"],
    ["clearing the max depth", { maxDepthMeters: null }, "maxDepthMeters"],
    ["one foot shallower", { maxDepthMeters: feetToMeters(99) }, "maxDepthMeters"],
  ])("names %s", (_label, change, field) => {
    expect(changedAdmissionFields(stored, { ...stored, ...change }, "feet")).toEqual([field]);
  });

  it("does not let a duplicated specialty stand in for a dropped one", () => {
    expect(
      changedAdmissionFields(
        stored,
        { ...stored, requiredSpecialties: ["wreck", "wreck"] },
        "feet",
      ),
    ).toEqual(["requiredSpecialties"]);
  });

  it("names a depth set where there was none, in metres too", () => {
    const blank = { ...stored, maxDepthMeters: null };
    expect(changedAdmissionFields(blank, { ...blank, maxDepthMeters: 18 }, "meters")).toEqual([
      "maxDepthMeters",
    ]);
  });
});
