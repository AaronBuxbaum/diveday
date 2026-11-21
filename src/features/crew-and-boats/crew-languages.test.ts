import { describe, expect, it } from "vitest";
import { crewLanguageBriefings } from "./crew-languages";

const crew = (name: string, ...languages: string[]) => ({ name, languages });
const diver = (name: string, language: string) => ({ name, language });

/** "Yusra Idrissi can brief Ines Costa and Diego Alvarez in Spanish." (item 48) */
describe("crewLanguageBriefings", () => {
  it("names the divers of a language nobody on the crew has recorded", () => {
    expect(
      crewLanguageBriefings({
        crew: [crew("Keiko Tanaka", "en")],
        divers: [diver("Ines Costa", "es"), diver("Diego Alvarez", "es")],
        shopLanguage: "en",
      }),
    ).toEqual({
      uncovered: [{ language: "es", divers: ["Ines Costa", "Diego Alvarez"], crew: [] }],
      covered: [],
    });
  });

  it("names who on the crew can brief them, and never the shop's own language", () => {
    expect(
      crewLanguageBriefings({
        crew: [crew("Yusra Idrissi", "en", "es"), crew("Keiko Tanaka", "en")],
        divers: [diver("Ines Costa", "es"), diver("Mara Quint", "en")],
        shopLanguage: "en",
      }),
    ).toEqual({
      uncovered: [],
      covered: [{ language: "es", divers: ["Ines Costa"], crew: ["Yusra Idrissi"] }],
    });
  });

  it("says nothing for divers who stated no language, or an empty boat", () => {
    expect(crewLanguageBriefings({ crew: [], divers: [], shopLanguage: "en" })).toEqual({
      uncovered: [],
      covered: [],
    });
  });

  it("names a diver once, however many seats they hold", () => {
    expect(
      crewLanguageBriefings({
        crew: [],
        divers: [diver("Ines Costa", "es"), diver("Ines Costa", "es")],
        shopLanguage: "en",
      }).uncovered,
    ).toEqual([{ language: "es", divers: ["Ines Costa"], crew: [] }]);
  });

  it("never says the shop's own language is missing, though no crew recorded it", () => {
    // Crew record their extra languages; the shop's own is every briefing's.
    expect(
      crewLanguageBriefings({
        crew: [crew("Yusra Idrissi", "es")],
        divers: [diver("Mara Quint", "en")],
        shopLanguage: "en",
      }),
    ).toEqual({ uncovered: [], covered: [] });
  });
});
