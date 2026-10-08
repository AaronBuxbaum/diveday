import { describe, expect, it } from "vitest";
import { parseRentalTerms, RENTAL_TERMS_MAX_LENGTH } from "./rental-terms";

describe("parseRentalTerms", () => {
  it("keeps the shop's own words, trimmed, with its line breaks", () => {
    expect(
      parseRentalTerms("  Rinse everything in fresh water.\r\nLost gear is charged at cost.  "),
    ).toEqual({
      ok: true,
      terms: "Rinse everything in fresh water.\nLost gear is charged at cost.",
    });
  });

  it("stores nothing for an empty box, so a ticket prints no terms", () => {
    expect(parseRentalTerms("   \n ")).toEqual({ ok: true, terms: null });
    expect(parseRentalTerms(null)).toEqual({ ok: true, terms: null });
    expect(parseRentalTerms(undefined)).toEqual({ ok: true, terms: null });
  });

  it("refuses terms longer than a ticket can carry rather than cutting them", () => {
    expect(parseRentalTerms("a".repeat(RENTAL_TERMS_MAX_LENGTH))).toEqual({
      ok: true,
      terms: "a".repeat(RENTAL_TERMS_MAX_LENGTH),
    });
    expect(parseRentalTerms("a".repeat(RENTAL_TERMS_MAX_LENGTH + 1))).toEqual({ ok: false });
  });

  it("refuses anything that is not text", () => {
    expect(parseRentalTerms(42)).toEqual({ ok: false });
  });
});
