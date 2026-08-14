import { describe, expect, it } from "vitest";
import { resolveCourseDepths } from "@/lib/courses";
import { SEA_STATES } from "@/lib/marine-forecast";
import { diverTranslator } from "./messages";
import { staffTranslator } from "./staff-messages";
import { courseDepthFormat, depthText, seaStateText, temperatureText } from "./unit-labels";

const en = diverTranslator("en-US");
const es = diverTranslator("es-ES");

describe("depthText / temperatureText", () => {
  it("writes a stored metric value in the shop's own unit", () => {
    expect(depthText(en, 18, "meters")).toBe("18 m");
    expect(depthText(en, 18.288, "feet")).toBe("60 ft");
    expect(temperatureText(en, 27, "celsius")).toBe("27°C");
    expect(temperatureText(en, 27, "fahrenheit")).toBe("81°F");
  });
});

describe("seaStateText", () => {
  // The forecast used to hand a diver the model's own numbers — "0.7 m seas
  // from E · 7 s period". Every part true, and close to useless to the person
  // deciding whether to bring a seasickness tablet. What reaches the page now
  // is a reading: what the sea is, and what that means for the day.
  it("names the band and says what it means for the day", () => {
    const light = seaStateText(en, "light_chop");
    expect(light.label).toBe("Light chop");
    expect(light.detail).toMatch(/small waves/i);

    // The roughest band describes the water and stops there. It used to say
    // this was "the kind of sea that often keeps boats at the dock" — a claim
    // about what a shop will *do*, which reads as "your trip is in doubt" to a
    // liveaboard's divers on a boat that sails happily in it. The forecast
    // never decides; the crew do, at the dock.
    const bad = seaStateText(en, "very_rough");
    expect(bad.label).toBe("Very rough");
    expect(bad.detail).toMatch(/steep seas/i);
    expect(bad.detail).not.toMatch(/cancel|at the dock|delay/i);
  });

  // The band is a code, not a word, so the reader's own language decides —
  // the same division every other measurement on this page goes through.
  it("reads in the reader's own language", () => {
    expect(seaStateText(es, "calm").label).toBe("En calma");
    expect(seaStateText(es, "choppy").label).toBe("Picado");
    expect(seaStateText(es, "choppy").detail).toMatch(/mareo/i);
  });

  // Every band has both halves in both bundles; a missing one would render an
  // ICU key on a diver's booking page.
  it("has words for every band", () => {
    for (const state of SEA_STATES) {
      for (const t of [en, es]) {
        const { label, detail } = seaStateText(t, state);
        expect(label).not.toContain("trip.");
        expect(detail).not.toContain("trip.");
        expect(label.length).toBeGreaterThan(0);
        expect(detail.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("courseDepthFormat", () => {
  it("spells the unit out, in the reader's own language", () => {
    const marker = "No deeper than {depth12}.";
    expect(resolveCourseDepths(marker, courseDepthFormat(en, "meters"))).toBe(
      "No deeper than 12 meters.",
    );
    expect(resolveCourseDepths(marker, courseDepthFormat(en, "feet"))).toBe(
      "No deeper than 40 feet.",
    );
    expect(resolveCourseDepths(marker, courseDepthFormat(es, "meters"))).toBe(
      "No deeper than 12 metros.",
    );
    expect(resolveCourseDepths(marker, courseDepthFormat(es, "feet"))).toBe(
      "No deeper than 40 pies.",
    );
  });

  it("shows a shop the marker syntax literally, not an empty ICU argument", () => {
    // The one copy in the app that *quotes* the marker grammar. It goes through
    // MessageFormat like every other staff string, so `{depth18}` has to be
    // apostrophe-quoted in the bundle or it reads as an argument nobody passes
    // and renders as nothing — a syntax hint teaching the wrong syntax.
    for (const t of [staffTranslator("en-US"), staffTranslator("es-ES")]) {
      for (const key of [
        "courses.edit.depthMarkersHint",
        "courses.edit.errorDepthPlaceholder",
      ] as const) {
        const message = t(key);
        expect(message).toContain("{depth18}");
        expect(message).toContain("{depth40}");
      }
    }
  });
});
