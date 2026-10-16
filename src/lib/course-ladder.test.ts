import { describe, expect, it } from "vitest";
import { type LadderCourse, nextCourseFor } from "./course-ladder";

const course = (id: string, extra: Partial<LadderCourse>): LadderCourse => ({
  id,
  title: id,
  agency: "padi",
  isActive: true,
  isIntroCourse: false,
  minimumCertificationLevel: null,
  certifiesLevel: null,
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
