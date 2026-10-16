import { describe, expect, it } from "vitest";
import { NOTICES, recordPaymentNotice } from "./order-detail-keys";

describe("recordPaymentNotice", () => {
  it("tells a payment still with Stripe apart from a real failure", () => {
    expect(recordPaymentNotice({ ok: false, reason: "claim_held" })).toBe("payment-in-flight");
    expect(recordPaymentNotice({ ok: false, reason: "stripe_unknown" })).toBe("payment-in-flight");
    expect(recordPaymentNotice({ ok: false, reason: "stripe_refused" })).toBe(
      "payment-stripe-refused",
    );
    expect(recordPaymentNotice({ ok: false, reason: "invalid" })).toBe("payment-record-failed");
    expect(recordPaymentNotice(null)).toBe("payment-record-failed");
  });

  it("names a notice the page can render for every outcome", () => {
    for (const reason of [
      "invalid",
      "stripe_refused",
      "stripe_unknown",
      "claim_held",
      "not_configured",
    ] as const) {
      expect(NOTICES[recordPaymentNotice({ ok: false, reason })]).toBeDefined();
    }
  });
});
