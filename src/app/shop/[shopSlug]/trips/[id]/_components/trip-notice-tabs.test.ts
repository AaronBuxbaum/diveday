import { describe, expect, it } from "vitest";
import { DETAILS_FORMS, ROSTER_FORMS } from "./trip-notice-tabs";

describe("which tab a save lands on", () => {
  it("returns a snorkeler and rider price save to Details, where the row lives", () => {
    expect(DETAILS_FORMS.has("participant-terms")).toBe(true);
  });

  it("never claims a form for both tabs", () => {
    for (const form of ROSTER_FORMS) expect(DETAILS_FORMS.has(form)).toBe(false);
  });
});
