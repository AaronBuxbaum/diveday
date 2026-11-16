import { describe, expect, it } from "vitest";
import { requestedAgencyFrom } from "./agency-param";

describe("requestedAgencyFrom", () => {
  it("reads one value, trimmed and lowercased", () => {
    expect(requestedAgencyFrom(" PADI ")).toBe("padi");
  });

  it("takes the first of a repeated param instead of throwing", () => {
    expect(requestedAgencyFrom(["SSI", "padi"])).toBe("ssi");
    expect(requestedAgencyFrom([])).toBeUndefined();
  });

  it("reads nothing as nothing", () => {
    expect(requestedAgencyFrom(undefined)).toBeUndefined();
    expect(requestedAgencyFrom("  ")).toBeUndefined();
  });
});
