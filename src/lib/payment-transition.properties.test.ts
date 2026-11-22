/**
 * Properties of `paymentTransitionRefusal` (src/lib/payment-transition.ts): a
 * payment status only moves forward under provider reconciliation.
 * That the locked writer does what this function says, for every pair, is
 * src/db/payments.test.ts ("agrees with the transition rule for every pair").
 */
import fc from "fast-check";
import { describe, expect } from "vitest";
import { type PaymentStatus, paymentStatus } from "@/db/schema";
import { property } from "@/test/property";
import {
  type CurrentPayment,
  FINAL_PAYMENT_STATUSES,
  isFinalPaymentStatus,
  paymentTransitionAllowed,
  paymentTransitionRefusal,
} from "./payment-transition";

const arbStatus = fc.constantFrom<PaymentStatus>(...paymentStatus.enumValues);
const arbProvider = fc.constantFrom<string | null>(null, "stripe", "mixed");
const arbCurrent: fc.Arbitrary<CurrentPayment> = fc.record({
  status: arbStatus,
  provider: arbProvider,
});

describe("paymentTransitionRefusal", () => {
  /** Refunded and waived are the final statuses, and both exist in the schema. */
  property("the final statuses are refunded and waived", [arbStatus], (status) => {
    expect(isFinalPaymentStatus(status)).toBe(status === "refunded" || status === "waived");
    expect([...FINAL_PAYMENT_STATUSES].every((s) => paymentStatus.enumValues.includes(s))).toBe(
      true,
    );
  });

  /** Once refunded or waived, no reconciliation writes a non-final status. */
  property(
    "no move out of a final status to a non-final one is allowed",
    [arbCurrent, arbStatus],
    (current, next) => {
      fc.pre(isFinalPaymentStatus(current.status) && !isFinalPaymentStatus(next));
      expect(paymentTransitionRefusal(current, next)).toBe("final");
      expect(paymentTransitionAllowed(current, next)).toBe(false);
    },
  );

  /** A refund or a waive is allowed from anywhere, a first write from nothing. */
  property(
    "every status can reach a final one, and anything follows no payment",
    [fc.option(arbCurrent, { nil: null }), arbStatus],
    (current, next) => {
      fc.pre(current === null || isFinalPaymentStatus(next));
      expect(paymentTransitionRefusal(current, next)).toBeNull();
    },
  );

  /**
   * A provider-held payment that already gave money back is not put back to
   * paid or deposit paid by an earlier event; money taken by hand is not
   * judged, since no provider event describes it.
   */
  property(
    "a partly refunded provider payment refuses every non-final status",
    [arbProvider, arbStatus],
    (provider, next) => {
      fc.pre(!isFinalPaymentStatus(next));
      expect(paymentTransitionRefusal({ status: "partly_refunded", provider }, next)).toBe(
        provider === null ? null : "partly_refunded",
      );
    },
  );

  /** Refusals are exactly those two cases: everything else moves. */
  property(
    "an unpaid, deposit-paid or paid booking accepts any status",
    [arbProvider, arbStatus],
    (provider, next) => {
      for (const status of ["unpaid", "deposit_paid", "paid"] as const) {
        expect(paymentTransitionAllowed({ status, provider }, next)).toBe(true);
      }
    },
  );

  /** Allowed is the absence of a refusal, never a second opinion. */
  property("allowed means no refusal", [fc.option(arbCurrent), arbStatus], (current, next) => {
    expect(paymentTransitionAllowed(current, next)).toBe(
      paymentTransitionRefusal(current, next) === null,
    );
  });
});
