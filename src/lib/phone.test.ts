import { describe, expect, it } from "vitest";
import { isE164, toE164 } from "./phone";

/**
 * `toE164` decides what a diver's number looks like in the row, and therefore
 * which record an inbound SMS or WhatsApp lands on (`phoneMatches`). Each case
 * below is one shape from the function's own list, including the ones that
 * resolve to null — those are not failures, they are the numbers the caller
 * must store exactly as typed.
 */
describe("toE164", () => {
  it("prefixes the shop's own calling code onto a bare national number", () => {
    expect(toE164("305-555-0110", "US")).toBe("+13055550110");
    expect(toE164("(305) 555 0110", "us")).toBe("+13055550110");
    // Eleven digits with the NANP trunk code already on the front.
    expect(toE164("1 305 555 0110", "US")).toBe("+13055550110");
  });

  it("takes an international number as written, whatever the shop's country", () => {
    expect(toE164("+1 (305) 555 0110", "US")).toBe("+13055550110");
    expect(toE164("+1 (305) 555 0110", "ES")).toBe("+13055550110");
    expect(toE164("+1 (305) 555 0110", null)).toBe("+13055550110");
    // A `00` international prefix is the `+`, not part of the number.
    expect(toE164("00 34 612 345 678", "US")).toBe("+34612345678");
  });

  it("drops one national trunk zero outside the NANP", () => {
    expect(toE164("0612 345 678", "ES")).toBe("+34612345678");
    expect(toE164("612 345 678", "ES")).toBe("+34612345678");
    expect(toE164("020 7946 0018", "GB")).toBe("+442079460018");
  });

  it("refuses a bare number it has no country to read against", () => {
    expect(toE164("305-555-0110", null)).toBeNull();
    expect(toE164("305-555-0110", "")).toBeNull();
    // A country the table does not carry: DiveDay does not know Japan's code,
    // so it guesses nothing.
    expect(toE164("90-1234-5678", "JP")).toBeNull();
  });

  it("refuses a bare NANP number that is not ten digits", () => {
    expect(toE164("555-0110", "US")).toBeNull();
    expect(toE164("305 555 011", "US")).toBeNull();
    expect(toE164("1305555011012", "CA")).toBeNull();
  });

  it("refuses anything outside E.164's own length, before or after the code", () => {
    expect(toE164("12345", "US")).toBeNull();
    expect(toE164("+1234567890123456", "US")).toBeNull();
    // Fifteen national digits in Portugal would be eighteen with the code on.
    expect(toE164("123456789012345", "PT")).toBeNull();
  });

  it("reads nothing out of nothing", () => {
    expect(toE164(null, "US")).toBeNull();
    expect(toE164(undefined, "US")).toBeNull();
    expect(toE164("   ", "US")).toBeNull();
    expect(toE164("call the shop", "US")).toBeNull();
  });
});

/**
 * The predicate a *reader* asks before it reshapes a stored number: what
 * `toE164` answers looks like this, and a `people.phone` that does not is text
 * a writer could not resolve and stored as typed (`displayStoredPhone`,
 * src/lib/forgiving-fields.ts, which shows such a row untouched).
 */
describe("isE164", () => {
  it.each(["+13055550110", "+34612345678", "+442079460018", "+1234567", "+123456789012345"])(
    "recognises %j as the stored shape",
    (value) => {
      expect(isE164(value)).toBe(true);
    },
  );

  it.each([
    // Grouped, punctuated, or bare — every shape that is not the column's own.
    "+1 305 555 0110",
    "+1-305-555-0110",
    "3055550110",
    // An extension is not part of the number, and the length bounds hold.
    "+13055550110 x21",
    "+123456",
    "+1234567890123456",
    "+",
    "",
    "ask at the desk",
  ])("refuses %j", (value) => {
    expect(isE164(value)).toBe(false);
  });
});
