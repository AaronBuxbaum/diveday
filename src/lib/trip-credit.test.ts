import { describe, expect, it } from "vitest";
import {
  buddyCreditEntryId,
  MAX_BUDDY_CREDIT_CENTS,
  MAX_TRIP_CREDIT_CENTS,
  safeTripCreditBalance,
  validBuddyCreditCents,
  validTripCreditAmount,
} from "./trip-credit";
import { isUuid } from "./uuid";

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

describe("buddy credit", () => {
  it("accepts zero (off) through the ceiling, in whole minor units", () => {
    expect(MAX_BUDDY_CREDIT_CENTS).toBe(1_000_000);
    expect(validBuddyCreditCents(0)).toBe(true);
    expect(validBuddyCreditCents(MAX_BUDDY_CREDIT_CENTS)).toBe(true);
    for (const amount of [-1, 1.5, NaN, MAX_BUDDY_CREDIT_CENTS + 1])
      expect(validBuddyCreditCents(amount)).toBe(false);
  });
  it("names one ledger entry per buddy seat, the same every time it is asked", () => {
    const seat = "3f1c2b6e-8a4d-4c1e-9b7a-2d5e6f708192";
    const other = "3f1c2b6e-8a4d-4c1e-9b7a-2d5e6f708193";
    expect(buddyCreditEntryId(seat)).toBe(buddyCreditEntryId(seat));
    expect(buddyCreditEntryId(seat)).toBe("b89d7dec-7bb7-5e71-aa24-dc4a26816d2a");
    expect(buddyCreditEntryId(seat)).not.toBe(buddyCreditEntryId(other));
    expect(isUuid(buddyCreditEntryId(seat))).toBe(true);
    expect(buddyCreditEntryId(seat)[14]).toBe("5");
    expect(buddyCreditEntryId(seat)).toBe(buddyCreditEntryId(seat.toUpperCase()));
  });
});
