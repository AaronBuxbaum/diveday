import { describe, expect, it } from "vitest";
import {
  discountedAmountCents,
  isPromoExhausted,
  isPromoRedeemable,
  isValidPromoDiscountPercent,
  normalizePromoCode,
  PROMO_CODE_MAX_LENGTH,
  type PromoScope,
  promoLedgerGroup,
  promoScopeCovers,
  promoWindowState,
} from "./promo-codes";

const NOON = new Date("2026-07-29T12:00:00.000Z");

function promo(overrides: Partial<Parameters<typeof isPromoRedeemable>[0]> = {}) {
  return {
    status: "active",
    scope: "all" as PromoScope,
    startsAt: null,
    expiresAt: null,
    ...overrides,
  };
}

describe("normalizePromoCode", () => {
  it("upper-cases and drops whitespace, so a code copied out of an email still matches", () => {
    expect(normalizePromoCode(" reef 20 ")).toBe("REEF20");
    expect(normalizePromoCode("summer-2026")).toBe("SUMMER-2026");
  });

  it("rejects punctuation rather than stripping it into a different shop's real code", () => {
    for (const value of ["reef;20", "REEF*20", "drop--table'"]) {
      expect(normalizePromoCode(value)).toBeNull();
    }
  });

  it("rejects codes that are too short or too long to be real", () => {
    expect(normalizePromoCode("AB")).toBeNull();
    expect(normalizePromoCode("A".repeat(PROMO_CODE_MAX_LENGTH))).toHaveLength(
      PROMO_CODE_MAX_LENGTH,
    );
    expect(normalizePromoCode("A".repeat(PROMO_CODE_MAX_LENGTH + 1))).toBeNull();
  });

  it("rejects non-strings and empty input", () => {
    for (const value of ["", "    ", null, undefined, 42, {}]) {
      expect(normalizePromoCode(value)).toBeNull();
    }
  });
});

describe("isValidPromoDiscountPercent", () => {
  it("accepts the whole 1–100 range the check constraint allows", () => {
    expect(isValidPromoDiscountPercent(1)).toBe(true);
    expect(isValidPromoDiscountPercent(100)).toBe(true);
  });

  it("refuses 0, over-100, fractional, and non-numeric discounts", () => {
    for (const value of [0, 101, -10, 12.5, "20", null]) {
      expect(isValidPromoDiscountPercent(value)).toBe(false);
    }
  });
});

describe("promoScopeCovers", () => {
  it("lets an all-scope code pay for either kind of booking", () => {
    expect(promoScopeCovers("all", "trip")).toBe(true);
    expect(promoScopeCovers("all", "course")).toBe(true);
  });

  it("keeps a trips-only code off a course, and a courses-only code off a trip", () => {
    expect(promoScopeCovers("trips", "trip")).toBe(true);
    expect(promoScopeCovers("trips", "course")).toBe(false);
    expect(promoScopeCovers("courses", "course")).toBe(true);
    expect(promoScopeCovers("courses", "trip")).toBe(false);
  });
});

describe("promoWindowState", () => {
  it("treats absent bounds as unbounded on that side", () => {
    expect(promoWindowState({ startsAt: null, expiresAt: null }, NOON)).toBe("live");
  });

  it("is not yet live before its start", () => {
    expect(
      promoWindowState({ startsAt: new Date("2026-08-01T00:00:00Z"), expiresAt: null }, NOON),
    ).toBe("not_started");
  });

  it("is dead at the expiry instant itself, not a moment after", () => {
    expect(promoWindowState({ startsAt: null, expiresAt: NOON }, NOON)).toBe("expired");
    expect(
      promoWindowState({ startsAt: null, expiresAt: new Date(NOON.getTime() + 1) }, NOON),
    ).toBe("live");
  });
});

describe("isPromoRedeemable", () => {
  it("accepts a live, active, in-scope code", () => {
    expect(isPromoRedeemable(promo(), "trip", NOON)).toBe(true);
  });

  it("refuses a code the shop switched off, or one that never minted at Stripe", () => {
    expect(isPromoRedeemable(promo({ status: "disabled" }), "trip", NOON)).toBe(false);
    expect(isPromoRedeemable(promo({ status: "failed" }), "trip", NOON)).toBe(false);
    expect(isPromoRedeemable(promo({ status: "pending" }), "trip", NOON)).toBe(false);
  });

  it("refuses an out-of-window or out-of-scope code", () => {
    expect(isPromoRedeemable(promo({ expiresAt: NOON }), "trip", NOON)).toBe(false);
    expect(
      isPromoRedeemable(promo({ startsAt: new Date("2026-08-01T00:00:00Z") }), "trip", NOON),
    ).toBe(false);
    expect(isPromoRedeemable(promo({ scope: "courses" }), "trip", NOON)).toBe(false);
  });
});

describe("discountedAmountCents", () => {
  it("mirrors Stripe's round-the-discount arithmetic so the quote matches the charge", () => {
    expect(discountedAmountCents(13000, 20)).toBe(10400);
    // 12345 * 15% = 1851.75 → discount rounds to 1852, leaving 10493.
    expect(discountedAmountCents(12345, 15)).toBe(10493);
  });

  it("handles the ends of the range without going negative", () => {
    expect(discountedAmountCents(13000, 100)).toBe(0);
    expect(discountedAmountCents(0, 50)).toBe(0);
  });
});

/**
 * Slice 9g of ADR 20260827-the-shops-shelves: the staff codes list is one
 * ledger grouped live / scheduled / ended.
 *
 * The rule worth pinning is which facts decide the shelf. The window and the
 * cap do; `status` does not — a shared fact belongs to the group header, an
 * exceptional one to the row's badge, and a grouping that swallowed `disabled`
 * or `failed` would put a code on a shelf that describes neither its window
 * nor its trouble. It is exactly the kind of rule a later "tidy-up" undoes
 * because the result looks neater.
 */
describe("promoLedgerGroup", () => {
  const shelf = (overrides: Partial<Parameters<typeof promoLedgerGroup>[0]> = {}) =>
    promoLedgerGroup(
      { startsAt: null, expiresAt: null, timesRedeemed: 0, maxRedemptions: null, ...overrides },
      NOON,
    );

  it("files an open, uncapped window as live", () => {
    expect(shelf()).toBe("live");
    expect(shelf({ expiresAt: new Date("2026-08-01T00:00:00Z") })).toBe("live");
  });

  it("files a window that has not opened as scheduled", () => {
    expect(shelf({ startsAt: new Date("2026-08-01T00:00:00Z") })).toBe("scheduled");
  });

  it("files an expired window as ended, on the instant it expires", () => {
    expect(shelf({ expiresAt: NOON })).toBe("ended");
  });

  it("files a code spent to its cap as ended, even with the window wide open", () => {
    expect(shelf({ timesRedeemed: 20, maxRedemptions: 20 })).toBe("ended");
    expect(shelf({ timesRedeemed: 19, maxRedemptions: 20 })).toBe("live");
  });

  it("never lets status choose the shelf — that is the row's badge, not the group", () => {
    // A switched-off code with a live window is on the Live shelf saying
    // "Switched off": the window is the shared fact, the switch is this one
    // row's exception. The type does not even accept a status, which is the
    // enforcement; this asserts the reading the type protects.
    const off = { startsAt: null, expiresAt: null, timesRedeemed: 3, maxRedemptions: null };
    expect(promoLedgerGroup(off, NOON)).toBe("live");
  });
});

describe("isPromoExhausted", () => {
  it("is never true for an uncapped code, however many times it has been used", () => {
    expect(isPromoExhausted({ timesRedeemed: 900, maxRedemptions: null })).toBe(false);
  });

  it("counts the cap as reached, not merely passed", () => {
    expect(isPromoExhausted({ timesRedeemed: 5, maxRedemptions: 5 })).toBe(true);
    expect(isPromoExhausted({ timesRedeemed: 4, maxRedemptions: 5 })).toBe(false);
  });
});
