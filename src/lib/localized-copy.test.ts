import { describe, expect, it } from "vitest";
import { copyForLocale, localizedCopy } from "./localized-copy";

describe("copyForLocale", () => {
  it("keeps legacy strings readable", () => {
    expect(copyForLocale("Sign your waiver", "es-MX")).toBe("Sign your waiver");
  });

  it("uses the requested locale, then the shop fallback, then the first translation", () => {
    const copy = { "en-US": "Sign your waiver", "es-MX": "Firma tu exención" };
    expect(copyForLocale(copy, "es-MX")).toBe("Firma tu exención");
    expect(copyForLocale(copy, "fr-FR")).toBe("Sign your waiver");
    expect(copyForLocale({ "es-MX": "Firma tu exención" }, "fr-FR")).toBe("Firma tu exención");
  });

  it("wraps seed/editor text without naming English in the value", () => {
    expect(localizedCopy("Complete your waiver", "en-US")).toEqual({
      "en-US": "Complete your waiver",
    });
  });
});
