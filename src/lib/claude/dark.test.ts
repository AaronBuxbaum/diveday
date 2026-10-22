import { describe, expect, it } from "vitest";
import { assistDarkReason, DEFAULT_SHOP_MONTHLY_CAP_USD, shopMonthlyCapMicroUsd } from "./dark";

const lit = {
  hasKey: true,
  externalHttpDisabled: false,
  shopEnabled: true,
  spentMicroUsd: 0,
  capMicroUsd: 15_000_000,
};

describe("assistDarkReason", () => {
  it("is null when every condition holds", () => {
    expect(assistDarkReason(lit)).toBeNull();
  });

  it("goes dark with no API key", () => {
    expect(assistDarkReason({ ...lit, hasKey: false })).toBe("no_key");
  });

  it("goes dark when external HTTP is switched off for the fleet", () => {
    expect(assistDarkReason({ ...lit, externalHttpDisabled: true })).toBe("external_http_disabled");
  });

  it("goes dark when the shop switched Claude suggestions off", () => {
    expect(assistDarkReason({ ...lit, shopEnabled: false })).toBe("shop_off");
  });

  it("goes dark for a demo shop, which anyone can mint", () => {
    expect(assistDarkReason({ ...lit, shopIsDemo: true })).toBe("demo_shop");
  });

  it("goes dark at the cap, not one micro-dollar past it", () => {
    expect(assistDarkReason({ ...lit, spentMicroUsd: 14_999_999 })).toBeNull();
    expect(assistDarkReason({ ...lit, spentMicroUsd: 15_000_000 })).toBe("over_cap");
    expect(assistDarkReason({ ...lit, spentMicroUsd: 20_000_000 })).toBe("over_cap");
  });

  it("reads an unknown spend as over the cap rather than as nothing spent", () => {
    expect(assistDarkReason({ ...lit, spentMicroUsd: Number.NaN })).toBe("over_cap");
    expect(assistDarkReason({ ...lit, spentMicroUsd: -1 })).toBe("over_cap");
  });

  it("names the cheapest-to-check reason first", () => {
    expect(
      assistDarkReason({
        hasKey: false,
        externalHttpDisabled: true,
        shopEnabled: false,
        spentMicroUsd: 99_000_000,
        capMicroUsd: 1,
      }),
    ).toBe("no_key");
  });
});

describe("shopMonthlyCapMicroUsd", () => {
  it("defaults to $15", () => {
    expect(DEFAULT_SHOP_MONTHLY_CAP_USD).toBe(15);
    expect(shopMonthlyCapMicroUsd({})).toBe(15_000_000);
  });

  it("takes a dollar override from the environment", () => {
    expect(shopMonthlyCapMicroUsd({ DIVEDAY_CLAUDE_SHOP_MONTHLY_CAP_USD: "40" })).toBe(40_000_000);
    expect(shopMonthlyCapMicroUsd({ DIVEDAY_CLAUDE_SHOP_MONTHLY_CAP_USD: "2.5" })).toBe(2_500_000);
    // Zero is a real choice: every shop dark without removing the key.
    expect(shopMonthlyCapMicroUsd({ DIVEDAY_CLAUDE_SHOP_MONTHLY_CAP_USD: "0" })).toBe(0);
  });

  it("ignores an override that is not a non-negative number", () => {
    for (const value of ["", "abc", "-5", "Infinity", "15usd"]) {
      expect(shopMonthlyCapMicroUsd({ DIVEDAY_CLAUDE_SHOP_MONTHLY_CAP_USD: value }), value).toBe(
        15_000_000,
      );
    }
  });
});
