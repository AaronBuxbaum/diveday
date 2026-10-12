// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { depthInUnit, maxEnteredDepth } from "@/lib/depth-units";
import { SiteDiveFields } from "./SiteDiveFields";
import { STORED } from "./site-fields-test-fixtures";

afterEach(cleanup);

const t = staffTranslator("en-US");
const field = (name: string) =>
  document.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);

describe("SiteDiveFields", () => {
  it("renders every dive fact blank on a new site", () => {
    render(<SiteDiveFields t={t} depthUnit="meters" />);
    for (const name of [
      "difficulty",
      "depthRange",
      "maxDepth",
      "expectedBottomTime",
      "currentNote",
      "divePlan",
      "conservationNote",
    ]) {
      expect(field(name)?.value, name).toBe("");
    }
  });

  it("enters the maximum depth in the shop's own unit, stored in metres", () => {
    render(<SiteDiveFields t={t} depthUnit="feet" values={{ ...STORED, maxDepthMeters: 18 }} />);
    const depth = field("maxDepth") as HTMLInputElement;
    expect(depth.value).toBe(String(depthInUnit(18, "feet")));
    expect(depth.max).toBe(String(maxEnteredDepth("feet")));
  });

  it("offers the three difficulty codes after the unset choice, the stored one picked", () => {
    render(
      <SiteDiveFields
        t={t}
        depthUnit="meters"
        values={{ ...STORED, difficultyLevel: "advanced" }}
      />,
    );
    const select = field("difficulty") as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual([
      "",
      "beginner",
      "intermediate",
      "advanced",
    ]);
    expect(select.value).toBe("advanced");
  });
});
