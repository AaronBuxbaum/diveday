/**
 * Properties of `safeTripCreditBalance` and `validTripCreditAmount`
 * (src/lib/trip-credit.ts): a credit balance is read only as a safe integer.
 * Example tests: trip-credit.test.ts.
 */
import fc from "fast-check";
import { describe, expect } from "vitest";
import { property } from "@/test/property";
import { MAX_TRIP_CREDIT_CENTS, safeTripCreditBalance, validTripCreditAmount } from "./trip-credit";

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const arbBigText = fc.oneof(
  fc.bigInt({ min: -(2n ** 70n), max: 2n ** 70n }).map(String),
  fc.bigInt({ min: SAFE - 1_000n, max: SAFE + 1_000n }).map(String),
  fc.bigInt({ min: SAFE, max: 2n ** 64n }).map(String),
  fc.string(),
  fc.constantFrom("1.5", "1e3", "NaN", "", " 1", "0x10"),
);

describe("trip credit amounts", () => {
  /**
   * A database balance is accepted exactly when it is a non-negative safe
   * integer, and then read as that integer: never rounded, never NaN.
   */
  property("a balance parses only to a safe integer", [arbBigText], (text) => {
    const balance = safeTripCreditBalance(text);
    if (balance === null) return;
    expect(Number.isSafeInteger(balance) && balance >= 0).toBe(true);
    expect(BigInt(text.trim())).toBe(BigInt(balance));
  });

  /** A grant or redemption is a positive integer within the column's range. */
  property("a credit amount is a positive safe integer in range", [fc.double()], (amount) => {
    if (!validTripCreditAmount(amount)) return;
    expect(Number.isSafeInteger(amount)).toBe(true);
    expect(amount > 0 && amount <= MAX_TRIP_CREDIT_CENTS).toBe(true);
  });
});
