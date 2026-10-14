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
});
