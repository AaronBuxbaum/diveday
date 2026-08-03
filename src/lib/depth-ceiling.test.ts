import { describe, expect, it } from "vitest";
import type { Certification, SpecialtyCertification } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { checkDepthCeiling, diverDepthLimit } from "./depth-ceiling";
import { feetToMeters } from "./depth-units";
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
  it("reads the ceiling off the ladder, as the agencies publish it — a metre/foot pair", () => {
    expect(diverDepthLimit([card("open_water")], [], TODAY)).toEqual({
      ceiling: { meters: 18, feet: 60 },
      basis: "certification",
      level: "open_water",
    });
    expect(diverDepthLimit([card("advanced_open_water")], [], TODAY)).toMatchObject({
      ceiling: { meters: 30, feet: 100 },
    });
    expect(diverDepthLimit([card("instructor")], [], TODAY)).toMatchObject({
      ceiling: { meters: 40, feet: 130 },
    });
  });

  it("does not extend depth for Rescue — it is a skills course, not a deeper one", () => {
    expect(diverDepthLimit([card("rescue")], [], TODAY)).toMatchObject({
      ceiling: { meters: 30, feet: 100 },
    });
  });

  it("takes the deepest card held, not the first", () => {
    expect(
      diverDepthLimit([card("open_water"), card("advanced_open_water")], [], TODAY),
    ).toMatchObject({ ceiling: { meters: 30 }, level: "advanced_open_water" });
  });

  it("falls to the entry-level ceiling with no verified card, not to silence", () => {
    // A trip with no `minimum_certification_level` — a DSD session, an
    // all-levels charter — raises no certification blocker either, so silence
    // here would leave the least-trained diver the one nothing is said about.
    for (const held of [
      [],
      [card("open_water", { status: "pending" })],
      [card("open_water", { expiresAt: "2026-07-23" })],
    ]) {
      expect(diverDepthLimit(held, [], TODAY)).toEqual({
        ceiling: { meters: 12, feet: 40 },
        basis: "no_card",
        level: null,
      });
    }
  });

  describe("Deep specialty", () => {
    it("lifts an Open Water diver to the recreational limit", () => {
      expect(diverDepthLimit([card("open_water")], [specialty()], TODAY)).toEqual({
        ceiling: { meters: 40, feet: 130 },
        basis: "deep_specialty",
        level: "open_water",
      });
    });

    it("never lowers a level that already reaches 40 m", () => {
      expect(diverDepthLimit([card("divemaster")], [specialty()], TODAY)).toMatchObject({
        ceiling: { meters: 40 },
        basis: "certification",
      });
    });

    it("ignores an unconfirmed imported card, matching the readiness gate", () => {
      const imported = specialty({ importedAt: nowDate(), reviewedAt: null });
      expect(diverDepthLimit([card("open_water")], [imported], TODAY)).toMatchObject({
        ceiling: { meters: 18 },
      });
    });

    it("ignores an expired card, exactly as the specialty readiness gate does", () => {
      // A shop that marked this card refresher-overdue has said it no longer
      // satisfies the deep gate; it must not keep buying depth here either.
      const stale = specialty({ expiresAt: "2026-07-23" });
      expect(diverDepthLimit([card("open_water")], [stale], TODAY)).toMatchObject({
        ceiling: { meters: 18 },
        basis: "certification",
      });
    });

    it("ignores a specialty that is not deep", () => {
      expect(
        diverDepthLimit([card("open_water")], [specialty({ specialty: "night" })], TODAY),
      ).toMatchObject({ ceiling: { meters: 18 } });
    });
  });

  describe("junior age bands", () => {
    it("caps 10- and 11-year-olds at 12 m whatever they hold", () => {
      expect(diverDepthLimit([card("open_water")], [], TODAY, "2015-01-01", TODAY)).toEqual({
        ceiling: { meters: 12, feet: 40 },
        basis: "junior_age",
        level: "open_water",
      });
      expect(
        diverDepthLimit([card("advanced_open_water")], [], TODAY, "2015-01-01", TODAY),
      ).toMatchObject({ ceiling: { meters: 12 } });
    });

    it("gives 12–14-year-olds 18 m on Open Water and 21 m on Advanced", () => {
      expect(diverDepthLimit([card("open_water")], [], TODAY, "2012-01-01", TODAY)).toMatchObject({
        ceiling: { meters: 18, feet: 60 },
        basis: "junior_age",
      });
      expect(
        diverDepthLimit([card("advanced_open_water")], [], TODAY, "2012-01-01", TODAY),
      ).toMatchObject({ ceiling: { meters: 21, feet: 70 }, basis: "junior_age" });
    });

    it("beats a Deep specialty rather than being widened by it", () => {
      expect(
        diverDepthLimit([card("advanced_open_water")], [specialty()], TODAY, "2012-01-01", TODAY),
      ).toMatchObject({ ceiling: { meters: 21 }, basis: "junior_age" });
    });

    it("lifts on the fifteenth birthday", () => {
      // 14 on the trip date: still junior-capped at 21 m on an AOW card's 30.
      expect(
        diverDepthLimit([card("advanced_open_water")], [], TODAY, "2011-07-25", TODAY),
      ).toMatchObject({ ceiling: { meters: 21 }, basis: "junior_age" });
      // 15 that same day: the adult ladder governs.
      expect(
        diverDepthLimit([card("advanced_open_water")], [], TODAY, "2011-07-24", TODAY),
      ).toMatchObject({ ceiling: { meters: 30 }, basis: "certification" });
    });

    it("holds an implausibly young age to the strictest band, not the adult ladder", () => {
      // Age 8 with a card is a typo or a bad import. A data-quality problem is
      // not a licence, so it falls conservative rather than through to 18 m.
      expect(diverDepthLimit([card("open_water")], [], TODAY, "2018-01-01", TODAY)).toMatchObject({
        ceiling: { meters: 12 },
        basis: "junior_age",
      });
    });

    it("falls back to the ladder when no date of birth is on file", () => {
      expect(diverDepthLimit([card("open_water")], [], TODAY, null, TODAY)).toMatchObject({
        basis: "certification",
        ceiling: { meters: 18 },
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

  it("is unknown when there is no limit to measure against", () => {
    expect(checkDepthCeiling(30, null)).toEqual({ status: "unknown" });
  });

  it("stays quiet when the site is within the diver's ceiling", () => {
    expect(checkDepthCeiling(18, openWater)).toEqual({
      status: "within",
      limitDepth: 18,
      siteDepth: 18,
      unit: "meters",
    });
  });

  it("warns — and reports both numbers and the rule that bit — when the site is deeper", () => {
    expect(checkDepthCeiling(30, openWater)).toEqual({
      status: "exceeds",
      limitDepth: 18,
      siteDepth: 30,
      unit: "meters",
      basis: "certification",
      level: "open_water",
    });
  });

  it("names the junior band when that is what set the ceiling", () => {
    const junior = diverDepthLimit([card("open_water")], [], TODAY, "2015-01-01", TODAY);
    expect(checkDepthCeiling(18, junior)).toMatchObject({
      status: "exceeds",
      limitDepth: 12,
      basis: "junior_age",
    });
  });

  describe("a shop working in feet", () => {
    it("does not warn on the textbook 60 ft reef", () => {
      // The regression this whole pair-of-units design exists for. 60 ft stores
      // as 18.288 m, which is > a bare 18, so comparing in stored metres told
      // every Open Water diver on the commonest dive in Florida that they were
      // over their limit — citing a ceiling of "59 ft", a number in no manual.
      expect(checkDepthCeiling(feetToMeters(60), openWater, "feet")).toEqual({
        status: "within",
        siteDepth: 60,
        limitDepth: 60,
        unit: "feet",
      });
    });

    it("does not warn on a 100 ft site for an Advanced diver", () => {
      const advanced = diverDepthLimit([card("advanced_open_water")], [], TODAY);
      expect(checkDepthCeiling(feetToMeters(100), advanced, "feet")).toMatchObject({
        status: "within",
      });
    });

    it("still warns, in feet, when the site is genuinely deeper", () => {
      expect(checkDepthCeiling(feetToMeters(100), openWater, "feet")).toMatchObject({
        status: "exceeds",
        siteDepth: 100,
        limitDepth: 60,
        unit: "feet",
      });
    });

    it("reads a feet-entered site correctly for a metric shop too", () => {
      // 18.288 m rounds to 18, which is the ceiling — not "18 m is deeper than 18 m".
      expect(checkDepthCeiling(feetToMeters(60), openWater, "meters")).toMatchObject({
        status: "within",
        siteDepth: 18,
        limitDepth: 18,
      });
    });
  });
});
