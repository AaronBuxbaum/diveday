import { describe, expect, it } from "vitest";
import { COMMON_SPOKEN_LANGUAGES, isSpokenLanguageTag } from "./spoken-languages";

describe("COMMON_SPOKEN_LANGUAGES", () => {
  it("is a list of distinct BCP-47 primary-language subtags, never free text", () => {
    expect(new Set(COMMON_SPOKEN_LANGUAGES).size).toBe(COMMON_SPOKEN_LANGUAGES.length);
    for (const tag of COMMON_SPOKEN_LANGUAGES) {
      expect(tag).toMatch(/^[a-z]{2,3}$/);
      // A tag Intl cannot canonicalise would render as its own code on the badge.
      expect(new Intl.Locale(tag).language).toBe(tag);
    }
  });

  it("still carries the two languages DiveDay itself speaks", () => {
    expect(COMMON_SPOKEN_LANGUAGES).toContain("en");
    expect(COMMON_SPOKEN_LANGUAGES).toContain("es");
  });
});

describe("isSpokenLanguageTag", () => {
  it("accepts exactly the curated tags", () => {
    for (const tag of COMMON_SPOKEN_LANGUAGES) expect(isSpokenLanguageTag(tag)).toBe(true);
  });

  it("refuses a region-qualified tag, a different case, a name, or an empty string", () => {
    for (const value of ["en-US", "EN", "English", "es-419", " en", "", "xx"]) {
      expect(isSpokenLanguageTag(value)).toBe(false);
    }
  });
});
