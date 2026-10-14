import { describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { payStepLines } from "./pay-step-lines";

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

  it("says a package dive is a tank: a two-tank boat uses two of the five (fourth UX review, item 9)", () => {
    expect(payStepLines(t, money, receipt, { left: 3, usedHere: 2 }).paidLine).toBe(
      "$180 · Uses 2 of your 5 package dives, one per tank",
    );
    expect(payStepLines(t, money, receipt, { left: 0, usedHere: 1 }).paidLine).toBe(
      "$180 · Uses 1 of your 1 package dive, one per tank",
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
