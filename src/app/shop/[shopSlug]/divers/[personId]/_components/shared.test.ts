import { describe, expect, it } from "vitest";
import { cardDisplayStatus, isCardExpired, isImportedCard, needsImportConfirm } from "./shared";

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

describe("imported card provenance and confirm nudge", () => {
  it("flags any card with an importedAt as imported", () => {
    expect(isImportedCard({ importedAt: new Date() })).toBe(true);
    expect(isImportedCard({ importedAt: null })).toBe(false);
    expect(isImportedCard({})).toBe(false);
  });

  it("needs a confirm only while imported and not yet reviewed", () => {
    // Imported, no staff review yet → the one-tap confirm nudge shows.
    expect(needsImportConfirm({ importedAt: new Date(), reviewedAt: null })).toBe(true);
    // Imported but a staffer already confirmed → no nudge; the imported flag stays.
    expect(needsImportConfirm({ importedAt: new Date(), reviewedAt: new Date() })).toBe(false);
    // A hand-entered card (never imported) is not a confirm-nudge case.
    expect(needsImportConfirm({ importedAt: null, reviewedAt: null })).toBe(false);
  });
});
