import { describe, expect, it } from "vitest";
import { HELD_CARD_STATUS_KEYS, heldCardStatusTone } from "@/i18n/card-labels";
import {
  certificationCardRowState,
  heldCardDisplayStatus,
  isImportedCard,
  isShopIssuedCard,
  needsImportConfirm,
} from "./certification-cards";

/**
 * Fixed instants, never a wall-clock read: nothing here is about *when* a card
 * arrived, and `pnpm check:clock` refuses one under `src/lib` for exactly that
 * reason.
 */
const IMPORTED_AT = new Date("2026-07-01T14:00:00Z");
const CONFIRMED_AT = new Date("2026-07-02T09:30:00Z");

describe("imported card provenance and confirm nudge", () => {
  it("flags any card with an importedAt as imported", () => {
    expect(isImportedCard({ importedAt: IMPORTED_AT })).toBe(true);
    expect(isImportedCard({ importedAt: null })).toBe(false);
    expect(isImportedCard({})).toBe(false);
  });

  it("needs a confirm only while imported and not yet reviewed", () => {
    // Imported, no staff review yet → the one-tap confirm nudge shows.
    expect(needsImportConfirm({ importedAt: IMPORTED_AT, reviewedAt: null })).toBe(true);
    // Imported but a staffer already confirmed → no nudge; the imported flag stays.
    expect(needsImportConfirm({ importedAt: IMPORTED_AT, reviewedAt: CONFIRMED_AT })).toBe(false);
    // A hand-entered card (never imported) is not a confirm-nudge case.
    expect(needsImportConfirm({ importedAt: null, reviewedAt: null })).toBe(false);
  });
});

describe("heldCardDisplayStatus", () => {
  it("distinguishes a card whose gate is still shut from one that clears", () => {
    // The badge is the only thing on screen saying so. A hand-verified card reads
    // plain "certified" and does clear; an imported, unconfirmed one holds its
    // gate — the specialty dive, or the enriched-air fill — so it must not look
    // identical at a busy desk (H-24).
    const confirmed = {
      status: "verified" as const,
      importedAt: IMPORTED_AT,
      reviewedAt: CONFIRMED_AT,
    };
    const unconfirmed = {
      status: "verified" as const,
      importedAt: IMPORTED_AT,
      reviewedAt: null,
    };
    const byHand = { status: "verified" as const, importedAt: null, reviewedAt: null };

    expect(heldCardDisplayStatus(unconfirmed)).toBe("confirm_to_clear");
    expect(HELD_CARD_STATUS_KEYS.confirm_to_clear).toBe("divers.shared.cardStatus.confirmToClear");
    expect(heldCardStatusTone("confirm_to_clear")).toBe("warning");

    // Both of these genuinely clear, so both keep the plain certified badge.
    expect(heldCardDisplayStatus(confirmed)).toBe("verified");
    expect(heldCardDisplayStatus(byHand)).toBe("verified");
    expect(heldCardStatusTone("verified")).toBe("success");
  });

  it("leaves a pending card pending, imported or not", () => {
    // There is no third display state to fall into any more: what the badge
    // shows is the stored status, plus the one imported-but-unconfirmed
    // overlay above (ADR 20260821-a-card-does-not-expire).
    expect(heldCardDisplayStatus({ status: "pending", importedAt: null, reviewedAt: null })).toBe(
      "pending",
    );
    expect(
      heldCardDisplayStatus({ status: "pending", importedAt: IMPORTED_AT, reviewedAt: null }),
    ).toBe("pending");
  });
});

describe("isShopIssuedCard", () => {
  it("marks only a card this shop's own instructor issued", () => {
    // Lands `verified` on the instructor's tap and never wants a confirm nudge,
    // which is what separates it from an imported card (issue #717).
    expect(isShopIssuedCard({ issuedByShopAt: IMPORTED_AT })).toBe(true);
    expect(isShopIssuedCard({ issuedByShopAt: null })).toBe(false);
    expect(isShopIssuedCard({})).toBe(false);
  });
});

/**
 * **The H-24 rule, flattened once and provably.**
 *
 * The shared person-row vocabulary (ADR 20260827-people-not-lists, decision 6)
 * gives `CertificationCardRow` a single four-value `state` prop, and flattening
 * two display unions into four values is exactly where the difference between
 * an imported *level* card and an imported *specialty* card gets lost. It is
 * lost silently and it is lost in the direction that hurts: a shut gate reading
 * as an open one puts a diver on a 30 m wall or hands them an enriched-air
 * tank. So the flattening happens once, here, and this is the test that says
 * which way each kind goes.
 */
describe("certificationCardRowState", () => {
  const importedUnreviewed = {
    status: "verified" as const,
    importedAt: new Date("2026-07-01"),
    reviewedAt: null,
  };

  it("holds an imported specialty or nitrox card at confirm-to-clear", () => {
    expect(certificationCardRowState("specialty", importedUnreviewed)).toBe("imported_unconfirmed");
    expect(certificationCardRowState("nitrox", importedUnreviewed)).toBe("imported_unconfirmed");
  });

  it("lets an imported level card read certified — it cleared readiness on arrival", () => {
    expect(certificationCardRowState("level", importedUnreviewed)).toBe("verified");
  });

  it("drops the hold once a staffer has confirmed the card", () => {
    const confirmed = { ...importedUnreviewed, reviewedAt: new Date("2026-07-02") };
    expect(certificationCardRowState("specialty", confirmed)).toBe("verified");
  });

  it("calls an unsighted claim what it is, whatever kind of card it claims", () => {
    // The weakest thing on the record — a stranger's typing on a public form —
    // and it outranks every other state because the shop holds no evidence at
    // all (ADR 20260814-self-declared-cards).
    const claim = { status: "pending" as const, selfDeclaredAt: new Date("2026-08-20") };
    expect(certificationCardRowState("level", claim)).toBe("self_declared");
    expect(certificationCardRowState("specialty", claim)).toBe("self_declared");
    expect(certificationCardRowState("nitrox", claim)).toBe("self_declared");
  });

  it("leaves an ordinary card at its stored status", () => {
    expect(certificationCardRowState("level", { status: "pending" })).toBe("pending");
    expect(certificationCardRowState("specialty", { status: "verified" })).toBe("verified");
  });
});
