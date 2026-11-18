import { describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { DIVER_LOCALES } from "@/i18n/settings";
import { STEPS } from "./home-steps";

describe("the homepage's walk", () => {
  it("has one slide per step, in a story with a beginning and an end", () => {
    expect(STEPS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(STEPS.map((step) => step.id)).size).toBe(STEPS.length);
  });

  it("shows a reader without the player five slides, one drawing each", () => {
    expect(STEPS.filter((step) => step.listed).map((step) => step.id)).toEqual([
      "pay",
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

  it("walks picking a boat from the page, paying, and the money landing, in that order", () => {
    expect(STEPS.slice(0, 3).map((step) => step.id)).toEqual(["browse", "pay", "money"]);
  });

  it("holds her medical answer and her signature in one slide, and cuts the dive computer", () => {
    const ids = STEPS.map((step) => step.id);
    expect(ids).toContain("sign");
    expect(ids).not.toContain("medical");
    expect(ids).not.toContain("select");
    expect(ids).not.toContain("computer");
  });

  it("gives the slides she types into a longer beat", () => {
    expect(STEPS.filter((step) => step.typed).map((step) => step.id)).toEqual([
      "pay",
      "onboard",
      "sign",
      "review",
    ]);
  });

  it("never repeats one heading for two slides", () => {
    const t = diverTranslator("en-US");
    const titles = STEPS.map((step) => t(`marketing.home.steps.${step.id}.title`));
    expect(new Set(titles).size).toBe(titles.length);
  });
});
