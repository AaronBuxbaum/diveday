import { describe, expect, it } from "vitest";
import type { Certification, SpecialtyCertification } from "@/db/schema";
import { checkDepthCeiling, diverDepthLimit } from "./depth-ceiling";
import type { CertificationLevel } from "./readiness";

const TODAY = "2026-07-24";

function card(level: CertificationLevel, overrides: Partial<Certification> = {}): Certification {
  return {
    status: "verified",
    level,
    expiresAt: null,
    ...overrides,
  } as Certification;
}

function specialty(overrides: Partial<SpecialtyCertification> = {}): SpecialtyCertification {
  return {
    specialty: "deep",
    status: "verified",
    expiresAt: null,
    importedAt: null,
    reviewedAt: null,
    ...overrides,
  } as SpecialtyCertification;
}

describe("diverDepthLimit", () => {
  it("reads the ceiling off the ladder", () => {
    expect(diverDepthLimit([card("open_water")], [], TODAY)).toEqual({
      limitMeters: 18,
      basis: "certification",
      level: "open_water",
    });
    expect(diverDepthLimit([card("advanced_open_water")], [], TODAY)).toMatchObject({
      limitMeters: 30,
    });
    expect(diverDepthLimit([card("instructor")], [], TODAY)).toMatchObject({ limitMeters: 40 });
  });

  it("does not extend depth for Rescue — it is a skills course, not a deeper one", () => {
    expect(diverDepthLimit([card("rescue")], [], TODAY)).toMatchObject({ limitMeters: 30 });
  });

  it("takes the deepest card held, not the first", () => {
    expect(
      diverDepthLimit([card("open_water"), card("advanced_open_water")], [], TODAY),
    ).toMatchObject({ limitMeters: 30, level: "advanced_open_water" });
  });

  it("is null with no verified card — an uncertified diver is readiness's problem, not depth's", () => {
    expect(diverDepthLimit([], [], TODAY)).toBeNull();
    expect(diverDepthLimit([card("open_water", { status: "pending" })], [], TODAY)).toBeNull();
    expect(
      diverDepthLimit([card("open_water", { expiresAt: "2026-07-23" })], [], TODAY),
    ).toBeNull();
  });

  describe("Deep specialty", () => {
    it("lifts an Open Water diver to the recreational limit", () => {
      expect(diverDepthLimit([card("open_water")], [specialty()], TODAY)).toEqual({
        limitMeters: 40,
        basis: "deep_specialty",
        level: "open_water",
      });
    });

    it("never lowers a level that already reaches 40 m", () => {
      expect(diverDepthLimit([card("divemaster")], [specialty()], TODAY)).toMatchObject({
        limitMeters: 40,
        basis: "certification",
      });
    });

    it("ignores an unconfirmed imported card, matching the readiness gate", () => {
      const imported = specialty({ importedAt: new Date(), reviewedAt: null });
      expect(diverDepthLimit([card("open_water")], [imported], TODAY)).toMatchObject({
        limitMeters: 18,
      });
    });

    it("ignores a specialty that is not deep", () => {
      expect(
        diverDepthLimit([card("open_water")], [specialty({ specialty: "night" })], TODAY),
      ).toMatchObject({ limitMeters: 18 });
    });
  });

  describe("junior age bands", () => {
    it("caps 10- and 11-year-olds at 12 m whatever they hold", () => {
      expect(diverDepthLimit([card("open_water")], [], TODAY, "2015-01-01", TODAY)).toEqual({
        limitMeters: 12,
        basis: "junior_age",
        level: "open_water",
      });
      expect(
        diverDepthLimit([card("advanced_open_water")], [], TODAY, "2015-01-01", TODAY),
      ).toMatchObject({ limitMeters: 12 });
    });

    it("gives 12–14-year-olds 18 m on Open Water and 21 m on Advanced", () => {
      expect(diverDepthLimit([card("open_water")], [], TODAY, "2012-01-01", TODAY)).toMatchObject({
        limitMeters: 18,
        basis: "junior_age",
      });
      expect(
        diverDepthLimit([card("advanced_open_water")], [], TODAY, "2012-01-01", TODAY),
      ).toMatchObject({ limitMeters: 21, basis: "junior_age" });
    });

    it("beats a Deep specialty rather than being widened by it", () => {
      expect(
        diverDepthLimit([card("advanced_open_water")], [specialty()], TODAY, "2012-01-01", TODAY),
      ).toMatchObject({ limitMeters: 21, basis: "junior_age" });
    });

    it("lifts on the fifteenth birthday", () => {
      // 14 on the trip date: still junior-capped at 18 m on an AOW card's 30.
      expect(
        diverDepthLimit([card("advanced_open_water")], [], TODAY, "2011-07-25", TODAY),
      ).toMatchObject({ limitMeters: 21, basis: "junior_age" });
      // 15 that same day: the adult ladder governs.
      expect(
        diverDepthLimit([card("advanced_open_water")], [], TODAY, "2011-07-24", TODAY),
      ).toMatchObject({ limitMeters: 30, basis: "certification" });
    });

    it("does not apply below the junior floor of 10", () => {
      // Nobody this young should hold a card at all; if one exists, the ladder
      // governs and the depth warning is not the place to editorialise.
      expect(diverDepthLimit([card("open_water")], [], TODAY, "2018-01-01", TODAY)).toMatchObject({
        basis: "certification",
      });
    });

    it("falls back to the ladder when no date of birth is on file", () => {
      expect(diverDepthLimit([card("open_water")], [], TODAY, null, TODAY)).toMatchObject({
        basis: "certification",
        limitMeters: 18,
      });
    });
  });
});

describe("checkDepthCeiling", () => {
  const openWater = diverDepthLimit([card("open_water")], [], TODAY);

  it("is unknown when the shop has recorded no site depth", () => {
    expect(checkDepthCeiling(null, openWater)).toEqual({ status: "unknown" });
    expect(checkDepthCeiling(undefined, openWater)).toEqual({ status: "unknown" });
    // Zero is not a real dive site depth; treat it as unrecorded, not as a
    // ceiling every diver on earth exceeds.
    expect(checkDepthCeiling(0, openWater)).toEqual({ status: "unknown" });
  });

  it("is unknown when there is no card to measure against", () => {
    expect(checkDepthCeiling(30, null)).toEqual({ status: "unknown" });
  });

  it("stays quiet when the site is within the diver's ceiling", () => {
    expect(checkDepthCeiling(18, openWater)).toEqual({
      status: "within",
      limitMeters: 18,
      siteMaxDepthMeters: 18,
    });
  });

  it("warns — and reports both numbers and the rule that bit — when the site is deeper", () => {
    expect(checkDepthCeiling(30, openWater)).toEqual({
      status: "exceeds",
      limitMeters: 18,
      siteMaxDepthMeters: 30,
      basis: "certification",
      level: "open_water",
    });
  });

  it("names the junior band when that is what set the ceiling", () => {
    const junior = diverDepthLimit([card("open_water")], [], TODAY, "2015-01-01", TODAY);
    expect(checkDepthCeiling(18, junior)).toMatchObject({
      status: "exceeds",
      limitMeters: 12,
      basis: "junior_age",
    });
  });
});
