import { describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { DIVER_LOCALES } from "@/i18n/settings";
import { STEPS, WALK } from "./home-steps";

describe("the homepage's walk", () => {
  it("names only steps and frames the list draws", () => {
    for (const beat of WALK) {
      const step = STEPS.find((candidate) => candidate.id === beat.step);
      expect(step?.frames.map((frame) => frame.id)).toContain(beat.frame);
    }
  });

  it("shows every drawn screen at least once", () => {
    const shown = new Set(WALK.map((beat) => `${beat.step}/${beat.frame}`));
    for (const step of STEPS) {
      for (const frame of step.frames) expect(shown).toContain(`${step.id}/${frame.id}`);
    }
  });

  it("gives each step exactly one screen for a reader without the player", () => {
    for (const step of STEPS) {
      expect(step.frames.filter((frame) => frame.primary)).toHaveLength(1);
    }
  });

  it.each(DIVER_LOCALES)("captions every beat in %s", (locale) => {
    const t = diverTranslator(locale);
    for (const beat of WALK) {
      expect(t(`marketing.home.walk.captions.${beat.caption}`).length).toBeGreaterThan(10);
    }
  });
});
