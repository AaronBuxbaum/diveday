import { describe, expect, it } from "vitest";
import type { AutomatedSurfaceConditions } from "@/lib/marine-forecast";
import { diverTranslator } from "./messages";
import { depthText, surfaceConditionsText, temperatureText } from "./unit-labels";

const en = diverTranslator("en-US");
const es = diverTranslator("es-ES");

const seaState = (
  overrides: Partial<AutomatedSurfaceConditions> = {},
): AutomatedSurfaceConditions => ({
  waveHeightMeters: 0.7,
  waveDirection: "e",
  wavePeriodSeconds: 7,
  ...overrides,
});

describe("depthText / temperatureText", () => {
  it("writes a stored metric value in the shop's own unit", () => {
    expect(depthText(en, 18, "meters")).toBe("18 m");
    expect(depthText(en, 18.288, "feet")).toBe("60 ft");
    expect(temperatureText(en, 27, "celsius")).toBe("27°C");
    expect(temperatureText(en, 27, "fahrenheit")).toBe("81°F");
  });
});

describe("surfaceConditionsText", () => {
  // DOM-L2: the forecast used to hand `src/app` a finished English metric
  // sentence, so a Florida crew reading feet was told "0.7 m waves from E"
  // on the same page whose water temperature it had already converted for
  // them. The unit is the shop's existing `depth_unit`, not a setting the
  // forecast grew for itself.
  it("writes the sea state in the shop's depth unit", () => {
    // "seas", not "waves": the reading is significant wave height (the mean of
    // the highest third), and individual sets run 1.5–2× it — "2 ft waves" reads
    // as a ceiling when it is an average (dive-domain-expert review, 2026-08-06).
    expect(surfaceConditionsText(en, seaState(), "meters")).toBe("0.7 m seas from E · 7 s period");
    expect(surfaceConditionsText(en, seaState(), "feet")).toBe("2 ft seas from E · 7 s period");
  });

  // Whole metres would collapse the entire range a reef boat actually sees;
  // whole feet keep the same readings apart without a decimal.
  it("keeps a tenth of a metre and rounds to a whole foot", () => {
    expect(surfaceConditionsText(en, seaState({ waveHeightMeters: 0.24 }), "meters")).toContain(
      "0.2 m",
    );
    expect(surfaceConditionsText(en, seaState({ waveHeightMeters: 1.37 }), "meters")).toContain(
      "1.4 m",
    );
    expect(surfaceConditionsText(en, seaState({ waveHeightMeters: 1.37 }), "feet")).toContain(
      "4 ft",
    );
  });

  it("drops the clause a reading is missing rather than leaving an empty one", () => {
    expect(surfaceConditionsText(en, seaState({ wavePeriodSeconds: null }), "meters")).toBe(
      "0.7 m seas from E",
    );
    expect(surfaceConditionsText(en, seaState({ waveDirection: null }), "meters")).toBe(
      "0.7 m seas · 7 s period",
    );
    expect(
      surfaceConditionsText(
        en,
        seaState({ waveDirection: null, wavePeriodSeconds: null }),
        "meters",
      ),
    ).toBe("0.7 m seas");
  });

  // The compass is not language-neutral: Spanish writes O for west and SO/NO
  // for the corners that touch it, and the decimal separator moves too. Both
  // come out of the bundle rather than out of `src/lib`.
  it("reads the compass and the decimal in the reader's own language", () => {
    expect(surfaceConditionsText(es, seaState(), "meters")).toBe(
      "mar de 0,7 m del E · periodo de 7 s",
    );
    expect(surfaceConditionsText(es, seaState({ waveDirection: "w" }), "meters")).toContain(
      "del O",
    );
    expect(surfaceConditionsText(es, seaState({ waveDirection: "sw" }), "meters")).toContain(
      "del SO",
    );
  });
});
