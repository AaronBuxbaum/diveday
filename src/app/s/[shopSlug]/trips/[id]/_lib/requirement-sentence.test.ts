import { describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { requirementSentenceFor } from "./requirement-sentence";

const t = diverTranslator("en-US");
const tEs = diverTranslator("es-ES");
const none = { minimumCertificationLevel: null, requiredSpecialties: [], requiresNitrox: false };

describe("requirementSentenceFor", () => {
  it("says nothing for a course session, which passes no requirement", () => {
    expect(requirementSentenceFor(null, t, "en-US")).toBeNull();
  });

  it("says nothing for a trip that asks nothing of anybody", () => {
    expect(requirementSentenceFor(none, t, "en-US")).toBeNull();
  });

  it("names what the trip asks, in one sentence, and nothing about the reader", () => {
    const sentence = requirementSentenceFor(
      { ...none, minimumCertificationLevel: "advanced_open_water", requiresNitrox: true },
      t,
      "en-US",
    );
    expect(sentence).toMatch(/Advanced/);
    expect(sentence).toMatch(/[Nn]itrox/);
    expect(sentence).not.toMatch(/\byou (?:hold|have)\b/i);
  });

  it("speaks the reader's language, its list joined the locale's way", () => {
    const sentence = requirementSentenceFor(
      { ...none, minimumCertificationLevel: "advanced_open_water", requiresNitrox: true },
      tEs,
      "es-ES",
    );
    expect(sentence).not.toBeNull();
    expect(sentence).toContain(" y ");
    expect(sentence).not.toContain(" and ");
  });

  // Issue #1866: admission is the weaker gate and never refuses someone
  // readiness would clear, so a level reads as a bar with a way through.
  describe("the way through (#1866)", () => {
    const level = { ...none, minimumCertificationLevel: "advanced_open_water" } as const;
    const askShop = "Not yet at that level? Ask the shop.";

    it("says to ask the shop, beside a required level", () => {
      expect(requirementSentenceFor(level, t, "en-US")).toBe(
        `This charter is for divers with Advanced Open Water or higher. ${askShop}`,
      );
    });

    it("says it to a known diver whose card is below the level, and to one with no card", () => {
      expect(requirementSentenceFor(level, t, "en-US", "open_water")).toContain(askShop);
      expect(requirementSentenceFor(level, t, "en-US", null)).toContain(askShop);
    });

    it("leaves it out for a known diver already at or above the level", () => {
      expect(requirementSentenceFor(level, t, "en-US", "advanced_open_water")).not.toContain(
        askShop,
      );
      expect(requirementSentenceFor(level, t, "en-US", "rescue")).not.toContain(askShop);
    });

    it("leaves it out when the trip asks for no level", () => {
      expect(
        requirementSentenceFor({ ...none, requiresNitrox: true }, t, "en-US", "open_water"),
      ).not.toContain("Ask the shop");
    });

    it("speaks Spanish too", () => {
      expect(requirementSentenceFor(level, tEs, "es-ES")).toContain("Pregunta al centro");
    });
  });
});
