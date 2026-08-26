import { describe, expect, it } from "vitest";
import { isStepUpPurpose, safeStepUpReturnPath, stepUpChallengeUrl } from "./security-step-up";

describe("security step-up routing", () => {
  it("accepts only an internal path in the current shop", () => {
    expect(safeStepUpReturnPath("blue-mantis", "/shop/blue-mantis/orders/new?draft=1")).toBe(
      "/shop/blue-mantis/orders/new?draft=1",
    );
    expect(safeStepUpReturnPath("blue-mantis", "/shop/other/orders/new")).toBeNull();
    expect(safeStepUpReturnPath("blue-mantis", "https://attacker.invalid/steal")).toBeNull();
    expect(safeStepUpReturnPath("blue-mantis", "//attacker.invalid/steal")).toBeNull();
  });

  it("serializes a bounded challenge with the original action path", () => {
    const url = stepUpChallengeUrl("blue-mantis", "money", "/shop/blue-mantis/orders/new");
    expect(url).toContain("/shop/blue-mantis/settings/security");
    expect(url).toContain("notice=step-up-required");
    expect(url).toContain("purpose=money");
    expect(url).toContain("returnTo=%2Fshop%2Fblue-mantis%2Forders%2Fnew");
  });

  it("recognizes only the supported sensitive-action purposes", () => {
    expect(isStepUpPurpose("money")).toBe(true);
    expect(isStepUpPurpose("export")).toBe(true);
    expect(isStepUpPurpose("backup")).toBe(true);
    expect(isStepUpPurpose("security")).toBe(false);
    expect(isStepUpPurpose(undefined)).toBe(false);
  });
});
