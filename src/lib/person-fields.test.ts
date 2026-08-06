import { describe, expect, it } from "vitest";
import {
  blankableDiverEmailSchema,
  DIVER_EMAIL_MAX,
  DIVER_NAME_MAX,
  DIVER_PHONE_MAX,
  diverEmailSchema,
  diverNameSchema,
  diverPhoneSchema,
} from "./person-fields";

describe("diver person-field fragments", () => {
  it("accepts a reasonable name, trimmed", () => {
    expect(diverNameSchema.parse("  Asha Sharma  ")).toBe("Asha Sharma");
  });

  it("accepts a single-character name — the most permissive of the drifted bounds", () => {
    expect(diverNameSchema.safeParse("Ka").success).toBe(true);
    expect(diverNameSchema.safeParse("K").success).toBe(true);
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(diverNameSchema.safeParse("").success).toBe(false);
    expect(diverNameSchema.safeParse("   ").success).toBe(false);
  });

  it("accepts exactly the name bound and rejects one past it", () => {
    expect(diverNameSchema.safeParse("x".repeat(DIVER_NAME_MAX)).success).toBe(true);
    expect(diverNameSchema.safeParse("x".repeat(DIVER_NAME_MAX + 1)).success).toBe(false);
  });

  it("accepts a real address up to the full 320-character bound", () => {
    // 320 is the widest of the drifted copies (the diver-record editor), so a
    // long address already stored there stays valid at every other door.
    const local = "a".repeat(64);
    const domain = `${"b".repeat(63)}.example.com`;
    const address = `${local}@${domain}`;
    expect(address.length).toBeLessThanOrEqual(DIVER_EMAIL_MAX);
    expect(diverEmailSchema.safeParse(address).success).toBe(true);
  });

  it("rejects a non-address and an address past the bound", () => {
    expect(diverEmailSchema.safeParse("not-an-email").success).toBe(false);
    const oversized = `${"a".repeat(DIVER_EMAIL_MAX)}@example.com`;
    expect(diverEmailSchema.safeParse(oversized).success).toBe(false);
  });

  it("blank-able email takes the empty string, a valid address, and nothing between", () => {
    expect(blankableDiverEmailSchema.safeParse("").success).toBe(true);
    expect(blankableDiverEmailSchema.safeParse("asha@example.com").success).toBe(true);
    expect(blankableDiverEmailSchema.safeParse("not-an-email").success).toBe(false);
  });

  it("accepts a phone at the bound, trimmed, and rejects one past it", () => {
    expect(diverPhoneSchema.parse(" +1-305-555-0231 ")).toBe("+1-305-555-0231");
    expect(diverPhoneSchema.safeParse("1".repeat(DIVER_PHONE_MAX)).success).toBe(true);
    expect(diverPhoneSchema.safeParse("1".repeat(DIVER_PHONE_MAX + 1)).success).toBe(false);
  });
});
