import { describe, expect, it } from "vitest";
import { parsePassThroughFee, passThroughTotalCents } from "./pass-through-fee";

/**
 * This is the only thing standing between a JSON column a shop edits and a
 * Stripe line item. Its own docblock says a malformed setting must never create
 * an arbitrary line item or a negative charge, and nothing checked that.
 */
describe("parsePassThroughFee", () => {
  it("accepts a well-formed fee", () => {
    expect(parsePassThroughFee({ name: "Marine park fee", amountCents: 1500 })).toEqual({
      name: "Marine park fee",
      amountCents: 1500,
    });
  });

  it("refuses a zero or negative amount rather than creating a credit", () => {
    for (const amountCents of [0, -1, -10_000]) {
      expect(parsePassThroughFee({ name: "Park", amountCents })).toBeNull();
    }
  });

  it("refuses a non-integer amount, so no fraction of a cent reaches Stripe", () => {
    for (const amountCents of [12.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(parsePassThroughFee({ name: "Park", amountCents })).toBeNull();
    }
  });

  it("refuses an implausibly large amount", () => {
    expect(parsePassThroughFee({ name: "Park", amountCents: 1_000_001 })).toBeNull();
    expect(parsePassThroughFee({ name: "Park", amountCents: 1_000_000 })).not.toBeNull();
  });

  it("refuses a missing, empty, or non-string name", () => {
    expect(parsePassThroughFee({ amountCents: 100 })).toBeNull();
    expect(parsePassThroughFee({ name: "   ", amountCents: 100 })).toBeNull();
    expect(parsePassThroughFee({ name: 42, amountCents: 100 })).toBeNull();
  });

  it("refuses anything that is not an object", () => {
    for (const value of [null, undefined, "fee", 100, [{ name: "Park", amountCents: 100 }]]) {
      expect(parsePassThroughFee(value)).toBeNull();
    }
  });

  it("trims and bounds the name a diver will read on the receipt", () => {
    const parsed = parsePassThroughFee({ name: `  ${"x".repeat(200)}  `, amountCents: 100 });
    expect(parsed?.name).toHaveLength(120);
  });
});

describe("passThroughTotalCents", () => {
  it("charges the fee once per diver", () => {
    const fee = { name: "Marine park fee", amountCents: 1500 };
    expect(passThroughTotalCents(fee, 1)).toBe(1500);
    expect(passThroughTotalCents(fee, 4)).toBe(6000);
  });

  it("is zero when there is no fee, or no diver to charge it to", () => {
    expect(passThroughTotalCents(null, 4)).toBe(0);
    for (const diverCount of [0, -1, 1.5, Number.NaN]) {
      expect(passThroughTotalCents({ name: "Park", amountCents: 1500 }, diverCount)).toBe(0);
    }
  });
});
