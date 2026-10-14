import { describe, expect, it } from "vitest";
import { heldCentsAfterMark, markNeedsWriteOffRight, readManualPaymentMark } from "./payment-marks";

describe("readManualPaymentMark", () => {
  it("reads money taken: the amount in minor units and the method", () => {
    expect(readManualPaymentMark("paid", "120", "cash", "usd")).toEqual({
      kind: "money",
      amountCents: 12_000,
      method: "cash",
    });
    expect(readManualPaymentMark("deposit_paid", "$54.50", "card", "usd")).toEqual({
      kind: "money",
      amountCents: 5_450,
      method: "card",
    });
  });

  it("reads a Spanish shop's comma decimal, and a zero-decimal currency", () => {
    expect(readManualPaymentMark("paid", "62,50", "other", "eur")).toEqual({
      kind: "money",
      amountCents: 6_250,
      method: "other",
    });
    expect(readManualPaymentMark("paid", "5000", "cash", "jpy")).toEqual({
      kind: "money",
      amountCents: 5_000,
      method: "cash",
    });
  });

  it("calls a paid mark with no amount, or zero, a mark with no money", () => {
    expect(readManualPaymentMark("paid", "", "cash", "usd")).toEqual({ kind: "no_money" });
    expect(readManualPaymentMark("paid", "  ", null, "usd")).toEqual({ kind: "no_money" });
    expect(readManualPaymentMark("deposit_paid", "0", "cash", "usd")).toEqual({
      kind: "no_money",
    });
  });

  it("refuses an amount it cannot read rather than guessing", () => {
    expect(readManualPaymentMark("paid", "abc", "cash", "usd")).toEqual({
      kind: "invalid",
      field: "amount",
    });
    expect(readManualPaymentMark("paid", "-20", "cash", "usd")).toEqual({
      kind: "invalid",
      field: "amount",
    });
    expect(readManualPaymentMark("paid", "99999999", "cash", "usd")).toEqual({
      kind: "invalid",
      field: "amount",
    });
  });

  it("refuses money with no method, or a method that is not one of the three", () => {
    expect(readManualPaymentMark("paid", "120", null, "usd")).toEqual({
      kind: "invalid",
      field: "method",
    });
    expect(readManualPaymentMark("paid", "120", "bitcoin", "usd")).toEqual({
      kind: "invalid",
      field: "method",
    });
  });

  it("ignores amount and method on a status that carries no money", () => {
    for (const status of ["unpaid", "waived", "refunded"] as const) {
      expect(readManualPaymentMark(status, "120", "cash", "usd")).toEqual({ kind: "not_money" });
    }
  });
});

describe("markNeedsWriteOffRight", () => {
  it("lets anyone record money, and only the write-off right mark a seat paid without any", () => {
    expect(markNeedsWriteOffRight({ kind: "money", amountCents: 100, method: "cash" })).toBe(false);
    expect(markNeedsWriteOffRight({ kind: "not_money" })).toBe(false);
    expect(markNeedsWriteOffRight({ kind: "no_money" })).toBe(true);
  });
});

describe("heldCentsAfterMark", () => {
  it("adds a balance to a deposit that was also marked by hand", () => {
    expect(
      heldCentsAfterMark(
        { status: "deposit_paid", amountCents: 5_000, provider: null },
        "paid",
        7_000,
      ),
    ).toBe(12_000);
  });

  it("leaves a checkout's deposit to Reports' own add-back, so it is not counted twice", () => {
    expect(
      heldCentsAfterMark(
        { status: "deposit_paid", amountCents: 5_000, provider: "stripe" },
        "paid",
        7_000,
      ),
    ).toBe(7_000);
  });

  it("replaces, never adds, when a mark corrects one already made", () => {
    expect(
      heldCentsAfterMark({ status: "paid", amountCents: 9_000, provider: null }, "paid", 12_000),
    ).toBe(12_000);
    expect(
      heldCentsAfterMark(
        { status: "deposit_paid", amountCents: 5_000, provider: null },
        "deposit_paid",
        6_000,
      ),
    ).toBe(6_000);
    expect(heldCentsAfterMark(null, "paid", 12_000)).toBe(12_000);
  });
});
