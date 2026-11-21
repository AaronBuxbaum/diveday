import { describe, expect, it } from "vitest";
import { parseCharterQuote } from "./charter-quote";

/** Loop 5, row 11: the whole-boat quote a reply to a charter request carries. */
describe("parseCharterQuote", () => {
  it("reads a blank box as no quote", () => {
    expect(parseCharterQuote("", "usd")).toEqual({ ok: true, cents: null });
    expect(parseCharterQuote("   ", "usd")).toEqual({ ok: true, cents: null });
  });

  it("reads the major unit the box shows into the shop's minor unit", () => {
    expect(parseCharterQuote("1800", "usd")).toEqual({ ok: true, cents: 180_000 });
    expect(parseCharterQuote("1800.50", "eur")).toEqual({ ok: true, cents: 180_050 });
    expect(parseCharterQuote("150000", "jpy")).toEqual({ ok: true, cents: 150_000 });
  });

  it("refuses nothing-amounts, negatives, words and figures past the price ceiling", () => {
    for (const bad of ["0", "-10", "abc", "1e3x", "100001", "0.001", "1800.555"]) {
      expect(parseCharterQuote(bad, "usd")).toEqual({ ok: false });
    }
    expect(parseCharterQuote("1500.5", "jpy")).toEqual({ ok: false });
  });
});
