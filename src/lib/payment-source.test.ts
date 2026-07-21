import { describe, expect, it } from "vitest";
import { paymentSourceLine } from "./payment-source";

describe("paymentSourceLine", () => {
  it("names Stripe when a card was taken online", () => {
    expect(paymentSourceLine("paid", "stripe")).toBe("Paid online · Stripe");
    expect(paymentSourceLine("deposit_paid", "stripe")).toBe("Paid online · Stripe");
  });

  it("names the counter when staff marked it paid manually", () => {
    expect(paymentSourceLine("paid", null)).toBe("Marked paid at the counter");
    expect(paymentSourceLine("deposit_paid", undefined)).toBe("Marked paid at the counter");
  });

  it("calls out a waived charge", () => {
    expect(paymentSourceLine("waived", null)).toBe("Waived — no charge");
  });

  it("adds no source line where the status already tells the story", () => {
    expect(paymentSourceLine("unpaid", null)).toBeNull();
    expect(paymentSourceLine("refunded", "stripe")).toBeNull();
    expect(paymentSourceLine(null, null)).toBeNull();
  });
});
