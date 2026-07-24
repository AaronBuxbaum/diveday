import { describe, expect, it } from "vitest";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, onboardSchema } from "./onboarding";

const validInput = {
  shopName: "Green Lagoon Divers",
  shopSlug: "green-lagoon",
  timezone: "America/New_York",
  ownerName: "Nora Quinn",
  ownerEmail: "nora@example.com",
  ownerPassword: "correct horse",
};

describe("onboardSchema (CR-014)", () => {
  it("accepts a well-formed submission", () => {
    expect(onboardSchema.safeParse(validInput).success).toBe(true);
  });

  it("rejects a well-formed but nonexistent timezone", () => {
    const result = onboardSchema.safeParse({ ...validInput, timezone: "Etc/Nowhere" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-timezone string", () => {
    const result = onboardSchema.safeParse({ ...validInput, timezone: "not a timezone" });
    expect(result.success).toBe(false);
  });

  it("rejects a password shorter than the minimum", () => {
    const result = onboardSchema.safeParse({
      ...validInput,
      ownerPassword: "x".repeat(MIN_PASSWORD_LENGTH - 1),
    });
    expect(result.success).toBe(false);
  });

  it("accepts a password at exactly the minimum", () => {
    const result = onboardSchema.safeParse({
      ...validInput,
      ownerPassword: "x".repeat(MIN_PASSWORD_LENGTH),
    });
    expect(result.success).toBe(true);
  });

  it("rejects a password longer than the maximum, so bcrypt never silently truncates it", () => {
    const result = onboardSchema.safeParse({
      ...validInput,
      ownerPassword: "x".repeat(MAX_PASSWORD_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });

  it("accepts a password at exactly the maximum", () => {
    const result = onboardSchema.safeParse({
      ...validInput,
      ownerPassword: "x".repeat(MAX_PASSWORD_LENGTH),
    });
    expect(result.success).toBe(true);
  });
});
