import { describe, expect, it } from "vitest";
import { buildDiveSiteLandmarks } from "./dive-site-landmarks";

describe("dive-site landmarks", () => {
  it("adds useful context to the seeded wreck landmarks", () => {
    const landmarks = buildDiveSiteLandmarks("Spiegel Grove", [
      "Flight deck and cranes",
      "Well deck",
    ]);

    expect(landmarks).toHaveLength(2);
    expect(landmarks[0]?.kind).toBe("Wreck feature");
    expect(landmarks[1]?.description).toContain("exterior");
  });

  it("keeps staff-authored landmark names useful without seeded editorial copy", () => {
    expect(buildDiveSiteLandmarks("Turtle Garden", ["Cleaning station"])).toEqual([
      {
        name: "Cleaning station",
        kind: "Point of interest",
        description: "A memorable reference point the crew can identify during the site briefing.",
      },
    ]);
  });
});
