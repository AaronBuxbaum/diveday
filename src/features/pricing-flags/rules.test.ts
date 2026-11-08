import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRICING_CONFIG } from "../../lib/billing/pricing-plans";
import { pricingConfig, readPricingFlags } from "./rules";

describe("readPricingFlags", () => {
  it("uses the published monthly price when neither component is configured", () => {
    expect(readPricingFlags({})).toEqual({ config: DEFAULT_PRICING_CONFIG, invalid: [] });
    expect(
      readPricingFlags({ PRICING_MONTHLY_CENTS: "  ", PRICING_BASIS_POINTS: "" }).config,
    ).toEqual(DEFAULT_PRICING_CONFIG);
  });
  it.each([
    [{ PRICING_MONTHLY_CENTS: "12900" }, { monthlyCents: 12900, basisPoints: 0 }],
    [{ PRICING_BASIS_POINTS: "300" }, { monthlyCents: 0, basisPoints: 300 }],
    [
      { PRICING_MONTHLY_CENTS: " 2900 ", PRICING_BASIS_POINTS: "250" },
      { monthlyCents: 2900, basisPoints: 250 },
    ],
    [{ PRICING_MONTHLY_CENTS: "0" }, { monthlyCents: 0, basisPoints: 0 }],
    [
      { PRICING_MONTHLY_CENTS: "100000", PRICING_BASIS_POINTS: "1000" },
      { monthlyCents: 100000, basisPoints: 1000 },
    ],
  ])("reads the configured components %j", (env, config) => {
    expect(readPricingFlags(env)).toEqual({ config, invalid: [] });
  });
  it.each([
    ["PRICING_MONTHLY_CENTS", "100001"],
    ["PRICING_MONTHLY_CENTS", "-1"],
    ["PRICING_MONTHLY_CENTS", "1e3"],
    ["PRICING_MONTHLY_CENTS", "99999999999999999999"],
    ["PRICING_BASIS_POINTS", "1001"],
    ["PRICING_BASIS_POINTS", "3%"],
    ["PRICING_BASIS_POINTS", "2.5"],
  ])("refuses the whole config for %s=%s", (name, value) => {
    expect(
      readPricingFlags({
        PRICING_MONTHLY_CENTS: "2900",
        PRICING_BASIS_POINTS: "250",
        [name]: value,
      }),
    ).toEqual({ config: DEFAULT_PRICING_CONFIG, invalid: [name] });
  });
});

describe("pricingConfig", () => {
  afterEach(() => vi.restoreAllMocks());
  it("logs a refusal once by variable name without its value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = { PRICING_BASIS_POINTS: "secret-looking-9999" };
    expect(pricingConfig(env)).toEqual(DEFAULT_PRICING_CONFIG);
    expect(pricingConfig(env)).toEqual(DEFAULT_PRICING_CONFIG);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain("PRICING_BASIS_POINTS");
    expect(line).not.toContain("secret-looking");
  });
});
