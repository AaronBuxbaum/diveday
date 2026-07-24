import { describe, expect, it } from "vitest";
import { emergencyContactSchema } from "./contact";

describe("emergencyContactSchema (CR-014)", () => {
  it("accepts a reasonable name and phone, trimmed", () => {
    const parsed = emergencyContactSchema.parse({
      emergencyContactName: "  Asha Sharma  ",
      emergencyContactPhone: " +1-305-555-0231 ",
    });
    expect(parsed).toEqual({
      emergencyContactName: "Asha Sharma",
      emergencyContactPhone: "+1-305-555-0231",
    });
  });

  it("accepts both fields absent", () => {
    expect(emergencyContactSchema.parse({})).toEqual({});
  });

  it("rejects a name over 120 characters", () => {
    const result = emergencyContactSchema.safeParse({ emergencyContactName: "x".repeat(121) });
    expect(result.success).toBe(false);
  });

  it("rejects a phone number over 40 characters", () => {
    const result = emergencyContactSchema.safeParse({ emergencyContactPhone: "1".repeat(41) });
    expect(result.success).toBe(false);
  });

  it("accepts exactly the bound", () => {
    const result = emergencyContactSchema.safeParse({
      emergencyContactName: "x".repeat(120),
      emergencyContactPhone: "1".repeat(40),
    });
    expect(result.success).toBe(true);
  });
});
