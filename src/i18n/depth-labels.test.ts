import { describe, expect, it } from "vitest";
import { staffDiveSiteDepthText } from "./depth-labels";
import { staffTranslator } from "./staff-messages";

describe("staffDiveSiteDepthText", () => {
  it("writes the range in the shop's unit and never both", () => {
    const t = staffTranslator("en-US");
    const site = { depthMinMeters: 15, maxDepthMeters: 28 };
    expect(staffDiveSiteDepthText(t, site, "meters")).toBe("15–28 m");
    expect(staffDiveSiteDepthText(t, site, "feet")).toBe("49–92 ft");
    expect(staffDiveSiteDepthText(t, { maxDepthMeters: 28 }, "feet")).toBe("92 ft");
    expect(staffDiveSiteDepthText(t, {}, "feet")).toBeNull();
    expect(staffDiveSiteDepthText(t, { depthRange: "to the wall" }, "feet")).toBe("to the wall");
    expect(
      staffDiveSiteDepthText(t, { depthRange: "to the wall", maxDepthMeters: 18 }, "feet"),
    ).toBe("59 ft");
  });

  it("reads the same in Spanish", () => {
    const t = staffTranslator("es-ES");
    expect(staffDiveSiteDepthText(t, { depthMinMeters: 6, maxDepthMeters: 18 }, "meters")).toBe(
      "6–18 m",
    );
  });
});
