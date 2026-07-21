import { describe, expect, it } from "vitest";
import { cardDisplayStatus, isCardExpired } from "./shared";

const NOW = new Date("2026-07-21T12:00:00Z");

describe("certification card display state", () => {
  it("treats a card past its expiry as expired", () => {
    expect(isCardExpired({ expiresAt: new Date("2026-01-01T00:00:00Z") }, NOW)).toBe(true);
  });

  it("does not treat a future or missing expiry as expired", () => {
    expect(isCardExpired({ expiresAt: new Date("2027-01-01T00:00:00Z") }, NOW)).toBe(false);
    expect(isCardExpired({ expiresAt: null }, NOW)).toBe(false);
    expect(isCardExpired({}, NOW)).toBe(false);
  });

  it("shows an expired verified card as `expired`, not `certified`", () => {
    expect(
      cardDisplayStatus({ status: "verified", expiresAt: new Date("2026-01-01T00:00:00Z") }, NOW),
    ).toBe("expired");
  });

  it("keeps a verified, unexpired card certified", () => {
    expect(cardDisplayStatus({ status: "verified", expiresAt: null }, NOW)).toBe("verified");
    expect(
      cardDisplayStatus({ status: "verified", expiresAt: new Date("2027-01-01T00:00:00Z") }, NOW),
    ).toBe("verified");
  });

  it("leaves a pending card pending even once its stated expiry has passed", () => {
    // Expiry is only meaningful for a card that was actually certified; a pending
    // card still needs staff review, so it must not read as `expired`.
    expect(
      cardDisplayStatus({ status: "pending", expiresAt: new Date("2026-01-01T00:00:00Z") }, NOW),
    ).toBe("pending");
  });
});
