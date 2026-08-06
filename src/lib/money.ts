/**
 * The shop's currency, and the arithmetic that depends on it (docs ADR
 * 20260731-shop-currency).
 *
 * DiveDay stores every amount as an integer count of the currency's **minor
 * unit** in a `*_cents` column. "Cents" is this codebase's word for that unit,
 * not a claim that there are always a hundred of them to the major unit: a
 * zero-decimal currency like JPY stores whole yen, so ¥5000 is `5000`, not
 * `500000`. Anything converting between the stored integer and a human number
 * goes through this module rather than a literal `100`.
 *
 * Stripe uses the same convention and the same lowercase ISO 4217 spelling,
 * which is why the stored value feeds Stripe unchanged.
 */

import { cachedFormatter } from "./intl-cache";

/**
 * Currencies a shop may choose. Deliberately a curated list rather than all of
 * ISO 4217: it is the picker's contents, and every entry is somewhere dive
 * shops actually operate. Lowercase to match Stripe (and the existing
 * `shop_stripe_accounts.default_currency`).
 *
 * Adding one is a one-line change — but check Stripe supports it as a
 * settlement currency for the country in question first, since a shop that
 * picks a currency its connected account can't settle gets a mismatch warning
 * and a refused checkout, not a silent conversion.
 */
export const SHOP_CURRENCIES = [
  "usd",
  "eur",
  "gbp",
  "cad",
  "aud",
  "nzd",
  "mxn",
  "brl",
  "thb",
  "idr",
  "php",
  "myr",
  "sgd",
  "jpy",
  "egp",
  "zar",
  "ils",
  "chf",
  "dkk",
  "nok",
  "sek",
] as const;

export type ShopCurrency = (typeof SHOP_CURRENCIES)[number];

export const DEFAULT_SHOP_CURRENCY: ShopCurrency = "usd";

export function isShopCurrency(value: unknown): value is ShopCurrency {
  return typeof value === "string" && (SHOP_CURRENCIES as readonly string[]).includes(value);
}

/**
 * A stored currency narrowed to one we actually support. Mirrors
 * `toDiverLocale`: a row written before a currency was retired, or by some
 * future admin tool, reads as the default rather than throwing inside
 * `Intl.NumberFormat` on every screen that shows a price.
 *
 * Case-insensitive because Stripe's API spells it lowercase while ISO 4217
 * and `Intl` spell it upper — both reach the same stored value.
 */
export function toShopCurrency(value: string | null | undefined): ShopCurrency {
  if (typeof value !== "string") return DEFAULT_SHOP_CURRENCY;
  const normalized = value.toLowerCase();
  return isShopCurrency(normalized) ? normalized : DEFAULT_SHOP_CURRENCY;
}

/**
 * How many decimal places this currency's major unit has — 2 for USD, 0 for
 * JPY. Read from CLDR via `Intl` rather than a hand-kept table so a currency
 * added to `SHOP_CURRENCIES` needs no second edit here, with 2 as the fallback
 * for a runtime whose data doesn't know the code (`Intl` reports 2 for an
 * unknown currency, which is also the right guess).
 */
export function currencyFractionDigits(currency: string): number {
  const { maximumFractionDigits } = cachedFormatter("num", Intl.NumberFormat, "en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).resolvedOptions();
  // Typed optional by the TS lib even though every runtime we ship on reports
  // it; 2 is the documented fallback either way.
  return maximumFractionDigits ?? 2;
}

/** Minor units per major unit — 100 for USD, 1 for JPY. */
export function currencyMinorUnits(currency: string): number {
  return 10 ** currencyFractionDigits(currency);
}

/**
 * A stored minor-unit integer as a major-unit number, e.g. 13000 usd → 130,
 * 5000 jpy → 5000. Lossy by definition (it is a float), so use it for display
 * and for prefilling a form field — never to compute an amount that is then
 * charged. Money arithmetic stays in integer minor units.
 */
export function minorToMajor(minorUnits: number, currency: string): number {
  return minorUnits / currencyMinorUnits(currency);
}

/**
 * A major-unit number a human typed as stored minor units, e.g. 130 usd →
 * 13000. Rounds, because `12.1 * 100` is `1209.9999...` in binary floating
 * point and a checkout must not be a cent short.
 */
export function majorToMinor(major: number, currency: string): number {
  return Math.round(major * currencyMinorUnits(currency));
}

/**
 * The ceiling every price box and price validator enforces, expressed in minor
 * units so it means the same *value* in every currency.
 *
 * It has to be stated this way round. The old cap was a flat `100_000` on the
 * typed number, which is $100,000 in USD but only ¥100,000 — about $650 — in
 * JPY, so a perfectly ordinary ¥150,000 course would have been refused as
 * absurd. Ten million minor units keeps the USD ceiling exactly where it was
 * and lands somewhere sane everywhere else.
 */
export const MAX_PRICE_MINOR_UNITS = 10_000_000;

/** `MAX_PRICE_MINOR_UNITS` as the largest number a price box may hold. */
export function maxPriceMajor(currency: string): number {
  return minorToMajor(MAX_PRICE_MINOR_UNITS, currency);
}

/**
 * The narrow currency symbol alone — "$", "€", "¥" — for labelling a bare
 * number field where a full formatted amount would not fit. Falls back to the
 * uppercase code when the locale has no symbol for it, which is the honest
 * answer rather than a wrong glyph.
 */
export function currencySymbol(currency: string, locale = "en-US"): string {
  const code = currency.toUpperCase();
  return (
    cachedFormatter("num", Intl.NumberFormat, locale, {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 0,
    })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value ?? code
  );
}
