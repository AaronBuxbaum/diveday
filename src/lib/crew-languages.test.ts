import { describe, expect, it } from "vitest";
import { crewLanguageGap } from "./crew-languages";

describe("crewLanguageGap", () => {
  it("reports none when a crew member covers every diver language", () => {
    expect(
      crewLanguageGap({
        crewSpokenLanguages: [["en"], ["es", "fr"]],
        diverLanguages: ["es"],
      }),
    ).toEqual({ code: "none" });
  });

  it("reports the uncovered language when nobody on the crew speaks it", () => {
    expect(
      crewLanguageGap({
        crewSpokenLanguages: [["en"]],
        diverLanguages: ["de"],
      }),
    ).toEqual({ code: "uncovered", missing: ["de"] });
  });

  it("reports every uncovered language, deduplicated, never a repeat per diver", () => {
    expect(
      crewLanguageGap({
        crewSpokenLanguages: [["en"]],
        diverLanguages: ["de", "de", "ja"],
      }),
    ).toEqual({ code: "uncovered", missing: ["de", "ja"] });
  });

  it("reports none for an empty crew with no diver languages to cover", () => {
    expect(crewLanguageGap({ crewSpokenLanguages: [], diverLanguages: [] })).toEqual({
      code: "none",
    });
  });

  it("reports none when nobody on the crew has recorded any language at all, but no diver signaled one either", () => {
    expect(
      crewLanguageGap({
        crewSpokenLanguages: [[], []],
        diverLanguages: [],
      }),
    ).toEqual({ code: "none" });
  });

  it("still reports a gap when the crew has recorded no languages and a diver signaled one", () => {
    expect(
      crewLanguageGap({
        crewSpokenLanguages: [[], []],
        diverLanguages: ["ja"],
      }),
    ).toEqual({ code: "uncovered", missing: ["ja"] });
  });
});
