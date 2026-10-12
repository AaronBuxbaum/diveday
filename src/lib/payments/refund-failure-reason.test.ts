import { describe, expect, it } from "vitest";
import { REFUND_FAILURE_REASONS, refundFailureReasonOf } from "./refund-failure-reason";

/**
 * The row this feeds is kept through an erasure on the promise of no free
 * text, so whatever Stripe sends is narrowed to its documented codes.
 */
describe("refundFailureReasonOf", () => {
  it("keeps every code Stripe documents, verbatim", () => {
    for (const code of REFUND_FAILURE_REASONS) {
      expect(refundFailureReasonOf(code)).toBe(code);
    }
  });

  it("answers nothing when Stripe gives no reason", () => {
    expect(refundFailureReasonOf(null)).toBeNull();
    expect(refundFailureReasonOf(undefined)).toBeNull();
  });

  it("stores anything else as Stripe's own `unknown`, never the text it was sent", () => {
    for (const raw of [
      "",
      "Card closed — call Jane Doe on +1 555 0100",
      "EXPIRED_OR_CANCELED_CARD",
      " declined",
      "a_code_stripe_adds_later",
      42,
      {},
    ]) {
      expect(refundFailureReasonOf(raw)).toBe("unknown");
    }
  });
});
