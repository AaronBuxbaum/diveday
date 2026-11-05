import { currencyFractionDigits, MAX_PRICE_MINOR_UNITS, majorToMinor } from "./money";

/**
 * **A private charter's quote, as the reply form posts it** (loop 5, row 11;
 * glossary "Charter inquiry"). The box holds the shop's major unit, the way
 * every price box does; the writer stores minor units in the shop's currency.
 * Blank is no quote. Anything that is not a positive amount under the price
 * ceiling is refused rather than sent to a diver as a number nobody meant.
 */
export function parseCharterQuote(
  raw: string,
  currency: string,
): { ok: true; cents: number | null } | { ok: false } {
  const text = raw.trim();
  if (!text) return { ok: true, cents: null };
  const match = /^\d+(?:\.(\d+))?$/.exec(text);
  // More decimals than the currency has would be rounded into a different figure.
  if (!match || (match[1]?.length ?? 0) > currencyFractionDigits(currency)) return { ok: false };
  const cents = majorToMinor(Number(text), currency);
  if (!Number.isInteger(cents) || cents <= 0 || cents > MAX_PRICE_MINOR_UNITS) return { ok: false };
  return { ok: true, cents };
}
