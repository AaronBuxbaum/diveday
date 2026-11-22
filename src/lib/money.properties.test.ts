/**
 * Properties of the currency conversions in `src/lib/money.ts`: a stored
 * amount is integer minor units, and a zero-decimal currency is never divided
 * by 100. Example tests: money.test.ts.
 */
import fc from "fast-check";
import { describe, expect } from "vitest";
import { arbCents, property } from "@/test/property";
import { currencyFractionDigits, majorToMinor, minorToMajor, SHOP_CURRENCIES } from "./money";

const arbCurrency = fc.constantFrom(...SHOP_CURRENCIES);

describe("minor and major units", () => {
  /** A zero-decimal currency's minor unit is its major unit: nothing is divided by 100. */
  property(
    "a zero-decimal amount converts to itself",
    [arbCurrency, arbCents],
    (currency, cents) => {
      if (currencyFractionDigits(currency) !== 0) return;
      expect(minorToMajor(cents, currency)).toBe(cents);
      expect(majorToMinor(cents, currency)).toBe(cents);
    },
  );

  /**
   * Every stored amount survives a trip through the price box: shown as major
   * units and read back, it is the same non-negative integer, never NaN or -0.
   */
  property(
    "major units round-trip to the same integer",
    [arbCurrency, arbCents],
    (currency, cents) => {
      const back = majorToMinor(minorToMajor(cents, currency), currency);
      expect(Object.is(back, cents)).toBe(true);
    },
  );
});
