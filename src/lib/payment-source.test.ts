import { describe, expect, it } from "vitest";
import { isCapturedPaymentStatus, paymentSourceLine } from "./payment-source";

describe("isCapturedPaymentStatus", () => {
  it("holds every state in which the shop is sitting on the diver's money", () => {
    expect(isCapturedPaymentStatus("paid")).toBe(true);
    expect(isCapturedPaymentStatus("deposit_paid")).toBe(true);
    // The one that was missed. A seat handed part of its money back is still
    // holding the rest, and four refund predicates read it as "never charged"
    // (issue #699 security review).
    expect(isCapturedPaymentStatus("partly_refunded")).toBe(true);
  });

  it("excludes a comped seat, which is owed nothing", () => {
    // The whole reason this is not `PAYMENT_CLEARED`: a waived diver may
    // board, and a refund path asking that set would offer to return money
    // that was never taken.
    expect(isCapturedPaymentStatus("waived")).toBe(false);
  });

  it("excludes the states holding nothing back", () => {
    expect(isCapturedPaymentStatus("unpaid")).toBe(false);
    expect(isCapturedPaymentStatus("refunded")).toBe(false);
    expect(isCapturedPaymentStatus(null)).toBe(false);
    expect(isCapturedPaymentStatus(undefined)).toBe(false);
  });
});

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
