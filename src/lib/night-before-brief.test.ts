import { describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { type BriefUnits, firstTimerReassuranceText, forecastText } from "./night-before-brief";

const t = diverTranslator("en-US");

/** What a metric shop reads — the default for a shop that has changed nothing. */
const METRIC: BriefUnits = { temperature: "celsius", depth: "meters" };
/** What a US shop reads once it has set both settings. */
const IMPERIAL: BriefUnits = { temperature: "fahrenheit", depth: "feet" };

const NONE = {
  waterTemperatureC: null,
  visibilityMeters: null,
  surfaceConditions: null,
  conditionsSummary: null,
};

describe("forecastText", () => {
  it("is null when the crew has published nothing", () => {
    expect(forecastText(t, "en-US", NONE, METRIC)).toBeNull();
  });

  it("leads with the crew summary and appends the measured stats", () => {
    expect(
      forecastText(
        t,
        "en-US",
        {
          conditionsSummary: "Warm and glassy — a perfect first-dive day",
          waterTemperatureC: 27,
          visibilityMeters: 20,
          surfaceConditions: "calm",
        },
        METRIC,
      ),
    ).toBe(
      "Warm and glassy — a perfect first-dive day. Expect water around 27°C, visibility near 20 m, and calm.",
    );
  });

  it("keeps the crew summary alone when there are no measured stats", () => {
    expect(
      forecastText(
        t,
        "en-US",
        { ...NONE, conditionsSummary: "Light chop, nothing to worry about." },
        METRIC,
      ),
    ).toBe("Light chop, nothing to worry about.");
  });

  it("renders stats without a summary as a plain expect-clause", () => {
    expect(
      forecastText(t, "en-US", { ...NONE, waterTemperatureC: 24, visibilityMeters: 12 }, METRIC),
    ).toBe("Expect water around 24°C and visibility near 12 m.");
  });

  it("renders a single measured stat with no list punctuation", () => {
    expect(forecastText(t, "en-US", { ...NONE, waterTemperatureC: 26 }, METRIC)).toBe(
      "Expect water around 26°C.",
    );
  });

  it("preserves surface casing like compass points", () => {
    expect(
      forecastText(t, "en-US", { ...NONE, surfaceConditions: "0.5 m waves from NE" }, METRIC),
    ).toBe("Expect 0.5 m waves from NE.");
  });

  it("writes both figures in a US shop's own units", () => {
    // The same stored row as the metric case above. A Florida shop's diver
    // reading "27°C" the night before a dive its trip page calls 81°F was the
    // bug this parameter exists to close.
    expect(
      forecastText(t, "en-US", { ...NONE, waterTemperatureC: 27, visibilityMeters: 20 }, IMPERIAL),
    ).toBe("Expect water around 81°F and visibility near 66 ft.");
  });

  it("honours the two settings independently", () => {
    // Feet with Celsius — the combination the old `depth_unit` derivation
    // could not express at all.
    expect(
      forecastText(
        t,
        "en-US",
        { ...NONE, waterTemperatureC: 27, visibilityMeters: 20 },
        { temperature: "celsius", depth: "feet" },
      ),
    ).toBe("Expect water around 27°C and visibility near 66 ft.");
  });

  it("writes the units in Spanish spacing for a Spanish-reading diver", () => {
    const es = diverTranslator("es-ES");
    expect(forecastText(es, "es-ES", { ...NONE, waterTemperatureC: 27 }, IMPERIAL)).toBe(
      "Prevé agua alrededor de 81 °F.",
    );
  });
});

describe("firstTimerReassuranceText", () => {
  it("is null for an experienced diver", () => {
    expect(firstTimerReassuranceText(t, false)).toBeNull();
  });

  it("offers a what-happens-on-the-boat line to a first-timer", () => {
    expect(firstTimerReassuranceText(t, true)).toContain("The crew walks everyone through");
  });
});
