import { describe, expect, it } from "vitest";
import {
  languageEndonym,
  languageEndonymList,
  languageNameIn,
  localeEndonym,
} from "./language-labels";
import { unsupportedLanguage } from "./negotiate";
import { DIVER_LOCALES } from "./settings";

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

describe("languageEndonymList", () => {
  it("deduplicates endonyms and drops a tag the runtime cannot name", () => {
    expect(languageEndonymList(["es", "ja", "es", "qtz"])).toEqual(["español", "日本語"]);
  });
});

describe("localeEndonym", () => {
  it("sentence-cases the name, so a switcher's options are not half-capitalised", () => {
    // CLDR follows each language's own orthography — English capitalises the
    // names of languages and Spanish does not — which put "English" beside
    // "español" on the same row of buttons and read as a bug.
    expect(localeEndonym("en-US")).toBe("English");
    expect(localeEndonym("es-ES")).toBe("Español");
  });

  it("names the language, never the region", () => {
    // Not "American English"/"español de España": DiveDay carries one bundle
    // per language, so the region is not a choice the reader is making.
    expect(localeEndonym("en-GB")).toBe("English");
  });

  it("gives every language DiveDay carries a capitalised label", () => {
    // The switcher is generated from this list (ShopNav, the public shop
    // header, the command palette), so a language added later cannot quietly
    // arrive lowercase beside the others.
    for (const locale of DIVER_LOCALES) {
      const label = localeEndonym(locale);
      expect(label).not.toBe("");
      expect(label).toBe(`${[...label][0].toLocaleUpperCase(locale)}${label.slice(1)}`);
    }
  });

  it("falls back to the tag rather than rendering a blank button", () => {
    expect(localeEndonym("qtz")).toBe("Qtz");
  });
});
