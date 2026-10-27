import { describe, expect, it } from "vitest";
import { legacyAddHref } from "./board-search-params";

describe("legacy schedule add links", () => {
  it("carries the chosen day, week and course to the creation page", () => {
    expect(
      legacyAddHref("reef", {
        add: "full",
        date: "2026-11-06",
        week: "2026-11-02",
        course: "course",
      }),
    ).toBe("/shop/reef/schedule/board/new?add=full&date=2026-11-06&course=course&week=2026-11-02");
  });

  it("leaves a normal board and the creation route alone", () => {
    expect(legacyAddHref("reef", { week: "2026-11-02" })).toBeNull();
    expect(legacyAddHref("reef", { _createPage: "1", add: "full" })).toBeNull();
  });
});
