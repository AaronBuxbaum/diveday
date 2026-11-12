import { describe, expect, it } from "vitest";
import { courseDoors } from "./doors";

const course = (id: string, extra = {}) => ({
  id,
  isActive: true,
  isIntroCourse: false,
  minimumCertificationLevel: null,
  certifiesLevel: null,
  sourceTemplateSlug: null,
  ...extra,
});
describe("courseDoors", () => {
  it("uses catalog facts across agencies, keeping the first matching shop course", () => {
    const catalog = [
      course("taster", { isIntroCourse: true }),
      course("cert", { certifiesLevel: "open_water" }),
      course("refresh", { sourceTemplateSlug: "scuba-refresher" }),
      course("other-taster", { isIntroCourse: true }),
    ];
    expect(courseDoors(catalog).map(({ kind, course }) => [kind, course.id])).toEqual([
      ["try", "taster"],
      ["certify", "cert"],
      ["refresh", "refresh"],
    ]);
  });
  it("omits absent doors and never infers a refresher or entry certification from a name", () => {
    expect(
      courseDoors([
        course("named", { title: "Try Scuba Refresher Open Water" }),
        course("hidden", { isActive: false, isIntroCourse: true }),
        course("advanced", { minimumCertificationLevel: "open_water", certifiesLevel: "advanced" }),
      ]),
    ).toEqual([]);
  });
});
