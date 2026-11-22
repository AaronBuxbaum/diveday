/**
 * Properties of `readExternalRefundAmount` (src/lib/payment-marks.ts): an
 * external refund records money already returned, never more than is held.
 * Example tests: payment-marks.test.ts.
 */
import fc from "fast-check";
import { describe, expect } from "vitest";
import { arbCents, property } from "@/test/property";
import { currencyFractionDigits, minorToMajor, SHOP_CURRENCIES } from "./money";
import { readExternalRefundAmount } from "./payment-marks";

describe("readExternalRefundAmount", () => {
  /**
   * Across any sequence of typed partial refunds against one payment, each
   * accepted refund is whole cents no larger than what is still held, so the
   * refunds together never exceed what was paid.
   */
  property(
    "a sequence of partial refunds never exceeds what was paid",
    [
      fc.constantFrom(...SHOP_CURRENCIES),
      arbCents,
      fc.array(fc.integer({ min: 0, max: 200_000_000 }), { maxLength: 8 }),
    ],
    (currency, paid, attempts) => {
      let held = paid;
      for (const attempt of attempts) {
        const typed = minorToMajor(attempt, currency).toFixed(currencyFractionDigits(currency));
        const refund = readExternalRefundAmount(typed, held, currency);
        if (refund === null) continue;
        expect(Number.isSafeInteger(refund) && refund > 0).toBe(true);
        expect(refund).toBeLessThanOrEqual(held);
        held -= refund;
      }
      expect(held).toBeGreaterThanOrEqual(0);
    },
  );
});
