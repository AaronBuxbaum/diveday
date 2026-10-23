import { describe, expect, it } from "vitest";
import { formShowedSpecies, SPECIES_SHOWN_FIELD } from "./species-shown";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("formShowedSpecies", () => {
  it("is true only when the form drew the picker's marker", () => {
    expect(formShowedSpecies(form({ [SPECIES_SHOWN_FIELD]: "1", observedSpeciesSlug: "" }))).toBe(
      true,
    );
    expect(formShowedSpecies(form({ observedSpeciesSlug: "spotted-eagle-ray" }))).toBe(false);
    expect(formShowedSpecies(form({ [SPECIES_SHOWN_FIELD]: "0" }))).toBe(false);
  });
});
