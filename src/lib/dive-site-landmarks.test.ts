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
    const [landmark] = buildDiveSiteLandmarks("Turtle Garden", ["Cleaning station"]);
    expect(landmark?.name).toBe("Cleaning station");
    expect(landmark?.kind).toBe("Point of interest");
    // A generic fallback description must still give the crew something to say.
    expect(landmark?.description).toBeTruthy();
  });
});
