import { describe, expect, it } from "vitest";
import { CERTIFICATION_AGENCIES } from "./certification-options";
import { SELF_DECLARED_AGENCIES } from "./self-registration";

describe("SELF_DECLARED_AGENCIES (the walk-up form's agencies)", () => {
  it("offers every agency a diver might name for their own card, TDI, IANTD and GUE included", () => {
    expect(SELF_DECLARED_AGENCIES).toEqual(
      expect.arrayContaining(["padi", "ssi", "naui", "sdi", "tdi", "iantd", "gue", "other"]),
    );
  });

  it("leaves out the cave-only agencies, which no walk-up dives on", () => {
    expect(SELF_DECLARED_AGENCIES).not.toContain("nss_cds");
    expect(SELF_DECLARED_AGENCIES).not.toContain("nacd");
  });

  it("is the enum minus exactly those two, so a new agency lands on the form by default", () => {
    expect([...SELF_DECLARED_AGENCIES]).toEqual(
      CERTIFICATION_AGENCIES.filter((agency) => agency !== "nss_cds" && agency !== "nacd"),
    );
  });
});
