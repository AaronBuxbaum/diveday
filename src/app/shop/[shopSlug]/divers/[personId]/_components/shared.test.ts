import { describe, expect, it } from "vitest";
import { cardDisplayStatus, isCardExpired } from "./shared";

const TODAY = "2026-07-21";

describe("certification card display state", () => {
  it("treats a card past its expiry as expired", () => {
    expect(isCardExpired({ expiresAt: "2026-01-01" }, TODAY)).toBe(true);
  });

  it("does not treat a future or missing expiry as expired", () => {
    expect(isCardExpired({ expiresAt: "2027-01-01" }, TODAY)).toBe(false);
    expect(isCardExpired({ expiresAt: null }, TODAY)).toBe(false);
    expect(isCardExpired({}, TODAY)).toBe(false);
  });

  it("shows an expired verified card as `expired`, not `certified`", () => {
    expect(cardDisplayStatus({ status: "verified", expiresAt: "2026-01-01" }, TODAY)).toBe(
      "expired",
    );
  });

  it("keeps a verified, unexpired card certified", () => {
    expect(cardDisplayStatus({ status: "verified", expiresAt: null }, TODAY)).toBe("verified");
    expect(cardDisplayStatus({ status: "verified", expiresAt: "2027-01-01" }, TODAY)).toBe(
      "verified",
    );
  });

  it("leaves a pending card pending even once its stated expiry has passed", () => {
    // Expiry is only meaningful for a card that was actually certified; a pending
    // card still needs staff review, so it must not read as `expired`.
    expect(cardDisplayStatus({ status: "pending", expiresAt: "2026-01-01" }, TODAY)).toBe(
      "pending",
    );
  });
});
