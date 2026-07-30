import { describe, expect, it } from "vitest";
import { buildDiveSiteLandmarks } from "./dive-site-landmarks";

describe("dive-site landmarks", () => {
  it("adds useful context to the seeded wreck landmarks", () => {
    const landmarks = buildDiveSiteLandmarks("Spiegel Grove", [
      "Flight deck and cranes",
      "Well deck",
    ]);

    expect(landmarks).toHaveLength(2);
    expect(landmarks[0]?.kind).toBe("wreckFeature");
    expect(landmarks[1]?.description).toBe("wellDeck");
  });

  it("keeps staff-authored landmark names useful without seeded editorial copy", () => {
    const [landmark] = buildDiveSiteLandmarks("Turtle Garden", ["Cleaning station"]);
    expect(landmark?.name).toBe("Cleaning station");
    expect(landmark?.kind).toBe("pointOfInterest");
    // A generic fallback description code must still resolve to something the
    // crew can say — never an empty or missing code.
    expect(landmark?.description).toBe("generic");
  });
});
