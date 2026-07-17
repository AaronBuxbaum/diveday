import { describe, expect, it } from "vitest";
import { isStaff } from "./authz";

describe("isStaff", () => {
  it("accepts any staff role", () => {
    expect(isStaff(["captain"])).toBe(true);
    expect(isStaff(["customer", "divemaster"])).toBe(true);
  });

  it("rejects customer-only and empty role sets", () => {
    expect(isStaff(["customer"])).toBe(false);
    expect(isStaff([])).toBe(false);
    expect(isStaff(undefined)).toBe(false);
  });
});
