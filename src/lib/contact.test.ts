import { describe, expect, it } from "vitest";
import { emergencyContactSchema, readEmergencyContact } from "./contact";

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

/**
 * The splice this exists to stop is written out once, over
 * `EmergencyContactSubmission` in `./contact.ts`. These are the four shapes
 * that rule has to distinguish, and the third and fourth are the ones that
 * used to be merged field by field.
 */
describe("readEmergencyContact", () => {
  it("takes both boxes as a pair, trimmed", () => {
    expect(readEmergencyContact({ name: "  Asha Sharma ", phone: " +1 305 555 0231 " })).toEqual({
      kind: "pair",
      name: "Asha Sharma",
      phone: "+1 305 555 0231",
    });
  });

  it("reads both boxes blank as the no-change case", () => {
    expect(readEmergencyContact({ name: "   ", phone: "" })).toEqual({ kind: "unchanged" });
    expect(readEmergencyContact({})).toEqual({ kind: "unchanged" });
    expect(readEmergencyContact({ name: null, phone: null })).toEqual({ kind: "unchanged" });
  });

  it("refuses a name with the number cleared, naming the empty box", () => {
    expect(readEmergencyContact({ name: "New Person", phone: "  " })).toEqual({
      kind: "half",
      missing: "phone",
    });
  });

  it("refuses a number with the name cleared", () => {
    expect(readEmergencyContact({ name: "", phone: "+1 305 555 0231" })).toEqual({
      kind: "half",
      missing: "name",
    });
  });
});
