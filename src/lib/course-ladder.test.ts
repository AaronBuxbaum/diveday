import { describe, expect, it } from "vitest";
import { type LadderCourse, ladderExclusion, nextCourseFor } from "./course-ladder";

const course = (id: string, extra: Partial<LadderCourse>): LadderCourse => ({
  id,
  title: id,
  agency: "padi",
  isActive: true,
  isIntroCourse: false,
  minimumCertificationLevel: null,
  certifiesLevel: null,
  minimumAge: null,
  ...extra,
});

const dsd = course("dsd", { isIntroCourse: true });
const ow = course("ow", { certifiesLevel: "open_water" });
const aow = course("aow", {
  minimumCertificationLevel: "open_water",
  certifiesLevel: "advanced_open_water",
});
const nitrox = course("nitrox", { minimumCertificationLevel: "open_water" });
const rescue = course("rescue", {
  minimumCertificationLevel: "advanced_open_water",
  certifiesLevel: "rescue",
});
const catalog = [dsd, ow, nitrox, aow, rescue];

describe("nextCourseFor", () => {
  it("leads a taster into the entry certification, and each card into the course it opens", () => {
    expect(nextCourseFor(dsd, catalog)?.id).toBe("ow");
    expect(nextCourseFor(ow, catalog)?.id).toBe("aow");
    expect(nextCourseFor(aow, catalog)?.id).toBe("rescue");
  });

  it("has no next step past the top, or from a course that certifies nothing", () => {
    expect(nextCourseFor(rescue, catalog)).toBeNull();
    expect(nextCourseFor(nitrox, catalog)).toBeNull();
  });

  it("stays within the agency, and skips a hidden course", () => {
    const ssiOw = course("ssi-ow", { agency: " SSI ", certifiesLevel: "open_water" });
    expect(nextCourseFor(ssiOw, catalog)).toBeNull();
    expect(nextCourseFor(ow, [dsd, ow, { ...aow, isActive: false }])).toBeNull();
  });
});

describe("ladderExclusion", () => {
  const nextAow = { certifiesLevel: "advanced_open_water" as const, minimumAge: null };
  const divemaster = { certifiesLevel: "divemaster" as const, minimumAge: 18 };
  const day = "2026-11-01";

  it("asks someone who holds only the level below", () => {
    expect(ladderExclusion(nextAow, { heldLevels: ["open_water"], dateOfBirth: null }, day)).toBeNull();
  });

  it("drops someone already holding the next card or higher, from any agency or source", () => {
    // Certified elsewhere, or an imported card: a level is a level, whoever issued it.
    expect(
      ladderExclusion(nextAow, { heldLevels: ["advanced_open_water"], dateOfBirth: null }, day),
    ).toBe("holds_next");
    expect(ladderExclusion(nextAow, { heldLevels: ["rescue"], dateOfBirth: null }, day)).toBe(
      "holds_next",
    );
    // A try-diver who certified at home is not asked to do Open Water.
    expect(
      ladderExclusion(
        { certifiesLevel: "open_water", minimumAge: 10 },
        { heldLevels: ["open_water"], dateOfBirth: null },
        day,
      ),
    ).toBe("holds_next");
  });

  it("drops a minor from a course with an adult minimum on the session's day, and fails open with no birthday", () => {
    expect(
      ladderExclusion(divemaster, { heldLevels: ["rescue"], dateOfBirth: "2011-03-01" }, day),
    ).toBe("under_age");
    expect(
      ladderExclusion(divemaster, { heldLevels: ["rescue"], dateOfBirth: "2008-11-01" }, day),
    ).toBeNull();
    expect(ladderExclusion(divemaster, { heldLevels: ["rescue"], dateOfBirth: null }, day)).toBeNull();
  });
});
