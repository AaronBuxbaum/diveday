import { describe, expect, it } from "vitest";
import { buddyAlertText, MAX_NAME_CHARS } from "./buddy-labels";
import { staffTranslator } from "./staff-messages";

const en = staffTranslator("en-US");
const es = staffTranslator("es-ES");

describe("buddyAlertText (#2403)", () => {
  it("keeps the generic words with no one named", () => {
    expect(buddyAlertText(en, "separated_dock")).toBe("Buddy not aboard yet");
    expect(buddyAlertText(en, "separated_after_dive", [])).toBe("Buddy not back aboard");
  });

  it("makes an ashore teammate a re-pairing instruction in both languages", () => {
    expect(buddyAlertText(en, "teammate_ashore")).toBe("Buddy staying ashore. Re-pair.");
    expect(buddyAlertText(es, "teammate_ashore")).toBe(
      "Compañero en tierra. Reorganiza la pareja.",
    );
    expect(buddyAlertText(en, "teammate_ashore", ["Ravi Patel"])).toBe(
      "Ravi staying ashore. Re-pair.",
    );
    expect(buddyAlertText(es, "teammate_ashore", ["Ravi Patel"])).toBe(
      "Ravi en tierra. Reorganiza la pareja.",
    );
  });

  it("names one missing teammate by first name, in both languages", () => {
    expect(buddyAlertText(en, "separated_dock", ["Ravi Patel"])).toBe("Ravi not aboard yet");
    expect(buddyAlertText(en, "separated_after_dive", ["Ravi Patel"])).toBe("Ravi not back aboard");
    expect(buddyAlertText(es, "separated_after_dive", ["Ravi Patel"])).toBe(
      "Ravi sin regresar a bordo",
    );
  });

  it("falls back to the generic words for two or more missing teammates", () => {
    expect(buddyAlertText(en, "separated_after_dive", ["Ravi Patel", "Mia Chen"])).toBe(
      "Buddy not back aboard",
    );
  });

  it("falls back to the generic words for a blank name, and trims a leading space", () => {
    expect(buddyAlertText(en, "separated_dock", ["   "])).toBe("Buddy not aboard yet");
    expect(buddyAlertText(en, "separated_dock", [" Ravi Patel"])).toBe("Ravi not aboard yet");
  });

  it("cuts a long first name with an ellipsis", () => {
    const text = buddyAlertText(en, "separated_dock", ["Bartholomew Quill"]);
    expect(text).toBe(`${"Bartholomew".slice(0, MAX_NAME_CHARS)}… not aboard yet`);
  });
});
