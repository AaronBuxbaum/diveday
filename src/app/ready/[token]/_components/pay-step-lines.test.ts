import { describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { atShopMoneyLine, payStepLines } from "./pay-step-lines";

const t = diverTranslator("en-US");
const money = (cents: number) => `$${cents / 100}`;
const receipt = { amountCents: 18_000, currency: "usd", isDeposit: false, balanceDueCents: 0 };
const none = { left: 0, usedHere: 0 };

describe("payStepLines", () => {
  it("says the figure paid, and nothing about packages to a diver who holds none", () => {
    expect(payStepLines(t, money, receipt, none).paidLine).toBe("$180");
  });

  it("says how many package dives are left beside it", () => {
    expect(payStepLines(t, money, receipt, { left: 1, usedHere: 0 }).paidLine).toBe(
      "$180 · 1 package dive left",
    );
    expect(payStepLines(t, money, receipt, { left: 7, usedHere: 0 }).paidLine).toBe(
      "$180 · 7 package dives left",
    );
  });

  // Fourth UX review item 9; dive-domain review N8 of layer r4-1: what is
  // left, never a total that looks like the card shrank.
  it("says a package dive is a tank, and how many are left", () => {
    expect(payStepLines(t, money, receipt, { left: 6, usedHere: 2 }).paidLine).toBe(
      "$180 · Uses 2 package dives (6 left), one per tank",
    );
    expect(payStepLines(t, money, receipt, { left: 0, usedHere: 1 }).paidLine).toBe(
      "$180 · Uses 1 package dive (0 left), one per tank",
    );
  });

  it("names a deposit's balance still to pay", () => {
    expect(
      payStepLines(t, money, { ...receipt, isDeposit: true, balanceDueCents: 5_000 }, none)
        .depositBalanceLine,
    ).toContain("$50");
    expect(payStepLines(t, money, receipt, none).depositBalanceLine).toBeNull();
  });
});

describe("atShopMoneyLine (fourth UX review, item 5)", () => {
  const trip = { priceCents: 9_500, depositCents: null, snorkelerPriceCents: 4_000, course: null };
  const owes = { owesAtShop: true, participantType: "diver" as const };
  const seat = (claimed: boolean) => ({ claimed, participantType: "diver" as const });

  it("says one seat's figure, due at the shop", () => {
    expect(atShopMoneyLine(t, "en-US", "usd", owes, trip, [])).toBe(
      "Your seat: $95.00, due at the shop.",
    );
  });

  it("counts the lead's unclaimed party seats, and leaves a claimed seat to its claimant", () => {
    expect(atShopMoneyLine(t, "en-US", "usd", owes, trip, [seat(false), seat(true)])).toBe(
      "2 seats: $190.00, due at the shop. 1 claimed seat is paid from its own page.",
    );
  });

  it("says nothing when nothing is owed at the shop", () => {
    expect(atShopMoneyLine(t, "en-US", "usd", { ...owes, owesAtShop: false }, trip, [])).toBeNull();
    expect(atShopMoneyLine(t, "en-US", "usd", owes, null, [])).toBeNull();
  });
});
