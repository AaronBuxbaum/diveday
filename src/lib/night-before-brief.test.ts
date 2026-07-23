import { describe, expect, it } from "vitest";
import { firstTimerReassurance, forecastLine } from "./night-before-brief";

const NONE = {
  waterTemperatureC: null,
  visibilityMeters: null,
  surfaceConditions: null,
  conditionsSummary: null,
};

describe("forecastLine", () => {
  it("is null when the crew has published nothing", () => {
    expect(forecastLine(NONE)).toBeNull();
  });

  it("leads with the crew summary and appends the measured stats", () => {
    expect(
      forecastLine({
        conditionsSummary: "Warm and glassy — a perfect first-dive day",
        waterTemperatureC: 27,
        visibilityMeters: 20,
        surfaceConditions: "calm",
      }),
    ).toBe(
      "Warm and glassy — a perfect first-dive day. Expect water around 27°C, visibility near 20 m, and calm.",
    );
  });

  it("keeps the crew summary alone when there are no measured stats", () => {
    expect(
      forecastLine({ ...NONE, conditionsSummary: "Light chop, nothing to worry about." }),
    ).toBe("Light chop, nothing to worry about.");
  });

  it("renders stats without a summary as a plain expect-clause", () => {
    expect(forecastLine({ ...NONE, waterTemperatureC: 24, visibilityMeters: 12 })).toBe(
      "Expect water around 24°C and visibility near 12 m.",
    );
  });

  it("renders a single measured stat with no list punctuation", () => {
    expect(forecastLine({ ...NONE, waterTemperatureC: 26 })).toBe("Expect water around 26°C.");
  });

  it("preserves surface casing like compass points", () => {
    expect(forecastLine({ ...NONE, surfaceConditions: "0.5 m waves from NE" })).toBe(
      "Expect 0.5 m waves from NE.",
    );
  });
});

describe("firstTimerReassurance", () => {
  it("is null for an experienced diver", () => {
    expect(firstTimerReassurance(false)).toBeNull();
  });

  it("offers a what-happens-on-the-boat line to a first-timer", () => {
    expect(firstTimerReassurance(true)).toContain("The crew walks everyone through");
  });
});
