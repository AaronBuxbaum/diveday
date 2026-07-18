import { describe, expect, it } from "vitest";
import { isStaff } from "./authz";

describe("isStaff", () => {
  it("accepts any staff role", () => {
    expect(isStaff(["owner"])).toBe(true);
    expect(isStaff(["diver", "divemaster"])).toBe(true);
    expect(isStaff([])).toBe(false);
    expect(isStaff(undefined)).toBe(false);
    expect(isStaff(["crew"])).toBe(true);
    expect(isStaff(["diver"])).toBe(false);
  });
});
