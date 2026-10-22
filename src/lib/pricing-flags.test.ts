import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRICING_CONFIG } from "@/lib/billing/pricing-plans";
import { pricingConfig, readPricingFlags } from "./pricing-flags";

describe("readPricingFlags", () => {
  it("is the defaults, test off, with nothing set", () => {
    expect(readPricingFlags({})).toEqual({ config: DEFAULT_PRICING_CONFIG, invalid: [] });
  });

  it("reads every variable", () => {
    expect(
      readPricingFlags({
        PRICING_TEST: "on",
        PRICING_PERCENT_SPLIT: "30",
        PRICING_FLAT_MONTHLY_CENTS: "12900",
        PRICING_PERCENT_BASIS_POINTS: "250",
        PRICING_PERCENT_MONTHLY_CENTS: " 2900 ",
      }).config,
    ).toEqual({
      test: true,
      split: 30,
      flat: { monthlyCents: 12_900 },
      percent: { basisPoints: 250, monthlyCents: 2_900 },
    });
  });

  it("turns the test on only for the word on", () => {
    for (const value of ["true", "1", "ON", "yes", "off", ""]) {
      expect(readPricingFlags({ PRICING_TEST: value }).config.test).toBe(false);
    }
    expect(readPricingFlags({ PRICING_TEST: " on " }).config.test).toBe(true);
  });

  it("takes a blank value as unset", () => {
    expect(readPricingFlags({ PRICING_PERCENT_SPLIT: "  " })).toEqual({
      config: DEFAULT_PRICING_CONFIG,
      invalid: [],
    });
  });

  it("accepts the edges of every bound", () => {
    expect(
      readPricingFlags({
        PRICING_PERCENT_SPLIT: "100",
        PRICING_FLAT_MONTHLY_CENTS: "100000",
        PRICING_PERCENT_BASIS_POINTS: "1000",
        PRICING_PERCENT_MONTHLY_CENTS: "0",
      }).invalid,
    ).toEqual([]);
  });

  it.each([
    ["PRICING_PERCENT_SPLIT", "101"],
    ["PRICING_PERCENT_SPLIT", "-1"],
    ["PRICING_PERCENT_SPLIT", "50.5"],
    ["PRICING_FLAT_MONTHLY_CENTS", "100001"],
    ["PRICING_FLAT_MONTHLY_CENTS", "$99"],
    ["PRICING_PERCENT_BASIS_POINTS", "1001"],
    ["PRICING_PERCENT_BASIS_POINTS", "3%"],
    ["PRICING_PERCENT_MONTHLY_CENTS", "1e3"],
    ["PRICING_PERCENT_MONTHLY_CENTS", "99999999999999999999"],
  ])("refuses the whole config for %s=%s, test off", (name, value) => {
    const read = readPricingFlags({
      PRICING_TEST: "on",
      PRICING_PERCENT_SPLIT: "20",
      [name]: value,
    });
    expect(read.config).toEqual(DEFAULT_PRICING_CONFIG);
    expect(read.invalid).toEqual([name]);
  });
});

describe("pricingConfig", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs a refusal once, by name and never by value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = { PRICING_PERCENT_BASIS_POINTS: "secret-looking-9999" };
    expect(pricingConfig(env)).toEqual(DEFAULT_PRICING_CONFIG);
    expect(pricingConfig(env)).toEqual(DEFAULT_PRICING_CONFIG);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain("pricing_flags.invalid");
    expect(line).toContain("PRICING_PERCENT_BASIS_POINTS");
    expect(line).not.toContain("secret-looking");
  });

  it("logs nothing for a usable config", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(pricingConfig({ PRICING_TEST: "on" }).test).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});
