import { describe, expect, it } from "vitest";
import { languageEndonym, languageNameIn } from "./language-labels";
import { unsupportedLanguage } from "./negotiate";

describe("languageEndonym", () => {
  it("names a language the way its own speakers write it", () => {
    // The whole point of the unsupported-language notice: the sentence around
    // this word is in a language the reader does not read, so this word is the
    // one that has to be recognisable to them.
    expect(languageEndonym("de")).toBe("Deutsch");
    expect(languageEndonym("fr")).toBe("français");
    expect(languageEndonym("ja")).toBe("日本語");
  });

  it("answers null for a code the runtime has no name for", () => {
    // `of()` hands the code straight back rather than throwing, which would
    // otherwise render as "DiveDay isn't in qtz yet".
    expect(languageEndonym("qtz")).toBeNull();
  });

  it("survives every code the header parser can hand it", () => {
    // The contract between the two: anything `unsupportedLanguage` returns is
    // safe to pass here, so a junk `Accept-Language` can never 500 a public page.
    for (const header of ["🙂", "de-DE", "qtz", "zh-Hant-TW", "fil-PH", "123", "-", "en_US"]) {
      const unsupported = unsupportedLanguage(header);
      if (!unsupported) continue;
      expect(() => languageEndonym(unsupported.language)).not.toThrow();
    }
  });
});

describe("languageNameIn", () => {
  it("names the shown language in the language it is shown in", () => {
    expect(languageNameIn("en", "en-US")).toBe("English");
    expect(languageNameIn("es", "es-ES")).toBe("español");
  });

  it("answers null rather than echoing an unnamed code", () => {
    expect(languageNameIn("qtz", "en-US")).toBeNull();
  });
});
