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
      expect(t(`marketing.home.steps.${step.id}.title`).length).toBeGreaterThan(10);
      expect(t(step.label).length).toBeGreaterThan(10);
      expect(t(step.note).length).toBeGreaterThan(10);
    }
  });

  it("walks picking a boat from the page through to Pay, then the payment, and the money landing, in that order", () => {
    expect(STEPS.slice(0, 3).map((step) => step.id)).toEqual(["browse", "pay", "money"]);
  });

  it("holds her medical answer and her signature in one slide, and cuts the dive computer", () => {
    const ids = STEPS.map((step) => step.id);
    expect(ids).toContain("sign");
    expect(ids).not.toContain("medical");
    expect(ids).not.toContain("select");
    expect(ids).not.toContain("computer");
  });

  it("gives the slides with something to do before the tap (typing, a scroll) a longer first phase", () => {
    expect(STEPS.filter((step) => (step.lead ?? 0) > 0).map((step) => step.id)).toEqual([
      "browse",
      "pay",
      "onboard",
      "sign",
      "recap",
      "review",
    ]);
  });

  it("never repeats one heading for two slides", () => {
    const t = diverTranslator("en-US");
    const titles = STEPS.map((step) => t(`marketing.home.steps.${step.id}.title`));
    expect(new Set(titles).size).toBe(titles.length);
  });
});
