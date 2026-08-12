import { describe, expect, it } from "vitest";
import { SEA_STATES } from "@/lib/marine-forecast";
import { diverTranslator } from "./messages";
import { depthText, seaStateText, temperatureText } from "./unit-labels";

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

    const bad = seaStateText(en, "very_rough");
    expect(bad.label).toBe("Very rough");
    expect(bad.detail).toMatch(/dock/i);
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
