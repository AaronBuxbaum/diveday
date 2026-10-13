import { describe, expect, it } from "vitest";
import { languageEndonymList } from "@/i18n/language-labels";
import { crewLanguagesSentence } from "./crew-languages";

describe("crewLanguagesSentence", () => {
  it("says nothing when the crew named no language", () => {
    expect(crewLanguagesSentence([], "en-US")).toBeNull();
  });

  it("names each language in its own words, joined the reader's way", () => {
    const names = languageEndonymList(["en", "es"] as never);
    const line = crewLanguagesSentence(["en", "es"] as never, "en-US");
    for (const name of names) expect(line).toContain(name);
    expect(line).toContain(" and ");
  });
});
