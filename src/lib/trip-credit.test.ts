import { describe, expect, it } from "vitest";
import { MAX_TRIP_CREDIT_CENTS, safeTripCreditBalance, validTripCreditAmount } from "./trip-credit";

describe("promotional trip credit arithmetic", () => {
  it("accepts only positive bounded integer cents", () => {
    expect(validTripCreditAmount(1)).toBe(true);
    expect(validTripCreditAmount(MAX_TRIP_CREDIT_CENTS)).toBe(true);
    for (const amount of [0, -1, 1.5, Infinity, NaN, MAX_TRIP_CREDIT_CENTS + 1])
      expect(validTripCreditAmount(amount)).toBe(false);
  });
  it("refuses corrupt, negative, and unsafe ledger totals", () => {
    expect(safeTripCreditBalance("9007199254740991")).toBe(Number.MAX_SAFE_INTEGER);
    for (const value of ["9007199254740992", "-1", "not-a-number", "1.5"])
      expect(safeTripCreditBalance(value)).toBeNull();
    expect(safeTripCreditBalance("0")).toBe(0);
  });
});
