import { describe, expect, it } from "vitest";
import { generateRecoveryCodes } from "./totp";

describe("generateRecoveryCodes", () => {
  it("creates codes accepted by the setup form", () => {
    const codes = generateRecoveryCodes(10);

    expect(codes).toHaveLength(10);
    expect(codes.every((code) => /^[A-Z2-7]{10}$/.test(code))).toBe(true);
  });
});
