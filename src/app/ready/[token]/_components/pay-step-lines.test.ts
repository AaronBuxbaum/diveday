import { describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { payStepLines } from "./pay-step-lines";

const t = diverTranslator("en-US");
const money = (cents: number) => `$${cents / 100}`;
const receipt = { amountCents: 18_000, currency: "usd", isDeposit: false, balanceDueCents: 0 };

describe("payStepLines", () => {
  it("says the figure paid, and nothing about packages to a diver who holds none", () => {
    expect(payStepLines(t, money, receipt, 0).paidLine).toBe("$180");
  });

  it("says how many package dives are left beside it", () => {
    expect(payStepLines(t, money, receipt, 1).paidLine).toBe("$180 · 1 package dive left");
    expect(payStepLines(t, money, receipt, 7).paidLine).toBe("$180 · 7 package dives left");
  });

  it("names a deposit's balance still to pay", () => {
    expect(
      payStepLines(t, money, { ...receipt, isDeposit: true, balanceDueCents: 5_000 }, 0)
        .depositBalanceLine,
    ).toContain("$50");
    expect(payStepLines(t, money, receipt, 0).depositBalanceLine).toBeNull();
  });
});
