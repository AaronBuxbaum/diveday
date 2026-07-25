import { describe, expect, it } from "vitest";
import {
  cardDisplayStatus,
  HELD_CARD_STATUS_LABELS,
  heldCardDisplayStatus,
  heldCardStatusTone,
  isCardExpired,
  isImportedCard,
  needsImportConfirm,
} from "./shared";

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

describe("heldCardDisplayStatus", () => {
  const today = "2026-07-25";

  it("distinguishes a card whose gate is still shut from one that clears", () => {
    // The badge is the only thing on screen saying so. A hand-verified card reads
    // plain "certified" and does clear; an imported, unconfirmed one holds its
    // gate — the specialty dive, or the enriched-air fill — so it must not look
    // identical at a busy desk (H-24).
    const confirmed = {
      status: "verified" as const,
      importedAt: new Date(),
      reviewedAt: new Date(),
    };
    const unconfirmed = { status: "verified" as const, importedAt: new Date(), reviewedAt: null };
    const byHand = { status: "verified" as const, importedAt: null, reviewedAt: null };

    expect(heldCardDisplayStatus(unconfirmed, today)).toBe("confirm_to_clear");
    expect(HELD_CARD_STATUS_LABELS.confirm_to_clear).toBe("certified · confirm to clear");
    expect(heldCardStatusTone("confirm_to_clear")).toBe("warning");

    // Both of these genuinely clear, so both keep the plain certified badge.
    expect(heldCardDisplayStatus(confirmed, today)).toBe("verified");
    expect(heldCardDisplayStatus(byHand, today)).toBe("verified");
    expect(heldCardStatusTone("verified")).toBe("success");
  });

  it("lets an overdue refresher outrank the confirm, since expiry is the harder fact", () => {
    expect(
      heldCardDisplayStatus(
        { status: "verified", expiresAt: "2026-07-17", importedAt: new Date(), reviewedAt: null },
        today,
      ),
    ).toBe("expired");
  });
});
