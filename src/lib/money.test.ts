import { describe, expect, it } from "vitest";
import { formatMoneyCents } from "./format";
import {
  currencyFractionDigits,
  currencyMinorUnits,
  currencySymbol,
  DEFAULT_SHOP_CURRENCY,
  isShopCurrency,
  majorToMinor,
  minorToMajor,
  SHOP_CURRENCIES,
  toShopCurrency,
} from "./money";

describe("toShopCurrency", () => {
  it("keeps a supported currency", () => {
    expect(toShopCurrency("eur")).toBe("eur");
  });

  it("normalizes the ISO-4217 uppercase spelling to Stripe's lowercase one", () => {
    expect(toShopCurrency("EUR")).toBe("eur");
  });

  // A row written by some future admin tool, or a currency later retired from
  // the picker, must render a price rather than throw inside Intl.
  it("falls back to the default for an unsupported or missing value", () => {
    expect(toShopCurrency("xyz")).toBe(DEFAULT_SHOP_CURRENCY);
    expect(toShopCurrency(null)).toBe(DEFAULT_SHOP_CURRENCY);
    expect(toShopCurrency(undefined)).toBe(DEFAULT_SHOP_CURRENCY);
    expect(toShopCurrency("")).toBe(DEFAULT_SHOP_CURRENCY);
  });

  it("rejects non-strings without throwing", () => {
    expect(toShopCurrency(42 as unknown as string)).toBe(DEFAULT_SHOP_CURRENCY);
  });
});

describe("isShopCurrency", () => {
  it("is case-sensitive on purpose — the stored spelling is lowercase", () => {
    expect(isShopCurrency("usd")).toBe(true);
    expect(isShopCurrency("USD")).toBe(false);
  });
});

describe("currency minor units", () => {
  it("is 100 for a two-decimal currency", () => {
    expect(currencyFractionDigits("usd")).toBe(2);
    expect(currencyMinorUnits("usd")).toBe(100);
    expect(currencyMinorUnits("EUR")).toBe(100);
  });

  // The whole reason this module exists: ¥5,000 is stored as 5000, not
  // 500000, so a literal /100 shows a ¥50 trip fee (src/db/tips.ts's task-35
  // note called this out as the known gap).
  it("is 1 for a zero-decimal currency", () => {
    expect(currencyFractionDigits("jpy")).toBe(0);
    expect(currencyMinorUnits("jpy")).toBe(1);
  });

  it("assumes two decimals for a code the runtime doesn't know", () => {
    expect(currencyMinorUnits("zzz")).toBe(100);
  });

  it("agrees with Intl for every currency in the picker", () => {
    for (const currency of SHOP_CURRENCIES) {
      const digits = currencyFractionDigits(currency);
      expect(currencyMinorUnits(currency)).toBe(10 ** digits);
    }
  });
});

describe("minorToMajor / majorToMinor", () => {
  it("round-trips a two-decimal amount", () => {
    expect(minorToMajor(13_000, "usd")).toBe(130);
    expect(majorToMinor(130, "usd")).toBe(13_000);
  });

  it("leaves a zero-decimal amount alone", () => {
    expect(minorToMajor(5_000, "jpy")).toBe(5_000);
    expect(majorToMinor(5_000, "jpy")).toBe(5_000);
  });

  // 12.1 * 100 is 1209.9999999999998 in binary floating point; truncating
  // would charge a diver a cent less than the price on the page.
  it("rounds rather than truncating a float that lands just short", () => {
    expect(majorToMinor(12.1, "usd")).toBe(1_210);
    expect(majorToMinor(49.99, "usd")).toBe(4_999);
    expect(majorToMinor(0.07, "usd")).toBe(7);
  });

  /**
   * Documented, accepted limitation. A literal half-minor-unit input can't
   * round half-up, because `1.005` is already `1.00499…` by the time this
   * function sees it — the precision was lost at the numeric literal, not
   * here. It doesn't matter in practice: this converts a price a human typed
   * into a two-decimal field, where half a cent is not an enterable amount,
   * and every amount DiveDay actually charges is computed in integer minor
   * units from there on.
   */
  it("cannot recover a half-minor-unit input the float already lost", () => {
    expect(majorToMinor(1.005, "usd")).toBe(100);
  });

  it("keeps zero at zero", () => {
    expect(majorToMinor(0, "jpy")).toBe(0);
    expect(minorToMajor(0, "usd")).toBe(0);
  });
});

describe("formatMoneyCents", () => {
  it("divides a two-decimal currency by its minor unit", () => {
    expect(formatMoneyCents(13_000, "usd", "en-US")).toBe("$130.00");
  });

  // The regression this change exists to prevent: before, a ¥5,000 fee
  // rendered as ¥50.
  it("does not divide a zero-decimal currency", () => {
    expect(formatMoneyCents(5_000, "jpy", "en-US")).toBe("¥5,000");
  });

  it("formats for the reader's locale, not the currency's home locale", () => {
    // es-ES writes the symbol after the number with a comma decimal mark.
    const spanish = formatMoneyCents(13_000, "eur", "es-ES");
    expect(spanish).toContain("130,00");
    expect(spanish).toContain("€");
  });

  it("accepts the uppercase spelling", () => {
    expect(formatMoneyCents(13_000, "USD", "en-US")).toBe("$130.00");
  });
});

describe("currencySymbol", () => {
  it("returns the narrow symbol, not the disambiguated one", () => {
    // en-US's default currencyDisplay would give "US$" for a non-local
    // currency; a bare amount field wants the glyph alone.
    expect(currencySymbol("usd", "en-US")).toBe("$");
    expect(currencySymbol("eur", "es-ES")).toBe("€");
    expect(currencySymbol("jpy", "en-US")).toBe("¥");
  });

  it("falls back to the uppercase code rather than a wrong glyph", () => {
    expect(currencySymbol("zzz", "en-US")).toBe("ZZZ");
  });
});
