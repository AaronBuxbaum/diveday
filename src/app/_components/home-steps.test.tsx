import { describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { DIVER_LOCALES } from "@/i18n/settings";
import { STEPS } from "./home-steps";

describe("the homepage's walk", () => {
  it("has one slide per step, in a story with a beginning and an end", () => {
    expect(STEPS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(STEPS.map((step) => step.id)).size).toBe(STEPS.length);
  });

  it("shows a reader without the player five slides, one drawing each", () => {
    expect(STEPS.filter((step) => step.listed).map((step) => step.id)).toEqual([
      "book",
      "sign",
      "check",
      "aboard",
      "recap",
    ]);
  });

  it.each(DIVER_LOCALES)("gives every slide its own copy in %s", (locale) => {
    const t = diverTranslator(locale);
    for (const step of STEPS) {
      for (const key of ["when", "title"] as const) {
        expect(t(`marketing.home.steps.${step.id}.${key}`).length).toBeGreaterThan(3);
      }
      expect(t(`marketing.home.walk.captions.${step.id}`).length).toBeGreaterThan(10);
      expect(t(step.label).length).toBeGreaterThan(10);
      for (const note of step.notes) expect(t(note).length).toBeGreaterThan(10);
    }
  });

  it("never repeats one heading for two slides", () => {
    const t = diverTranslator("en-US");
    const titles = STEPS.map((step) => t(`marketing.home.steps.${step.id}.title`));
    expect(new Set(titles).size).toBe(titles.length);
  });
});
