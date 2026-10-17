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
      "minDepth",
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

  /** The range is two numbers in the shop's unit, never prose that can name the other one (#2426). */
  it("enters the shallow end beside the maximum, both in the shop's own unit", () => {
    render(
      <SiteDiveFields
        t={t}
        depthUnit="feet"
        values={{ ...STORED, depthMinMeters: 6.096, maxDepthMeters: 18.288 }}
      />,
    );
    expect((field("minDepth") as HTMLInputElement).value).toBe("20");
    expect((field("maxDepth") as HTMLInputElement).value).toBe("60");
    expect(document.body.textContent).toContain("Shallowest depth (feet)");
    expect(document.body.textContent).toContain("Maximum depth (feet)");
    cleanup();
    render(<SiteDiveFields t={t} depthUnit="meters" />);
    expect(document.body.textContent).toContain("Shallowest depth (meters)");
  });

  it("keeps the shop's own words as a note that asks for no unit", () => {
    render(
      <SiteDiveFields
        t={t}
        depthUnit="feet"
        values={{ ...STORED, depthRange: "shallow ledge to the wall" }}
      />,
    );
    const note = field("depthRange") as HTMLInputElement;
    expect(note.value).toBe("shallow ledge to the wall");
    expect(note.placeholder).toBe("");
    expect(document.body.textContent).toContain("Depth note");
  });
});
