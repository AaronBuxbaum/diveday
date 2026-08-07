import { cachedCollator, cachedDisplayNames } from "@/lib/intl-cache";
import { currencySymbol, SHOP_CURRENCIES, type ShopCurrency } from "@/lib/money";

/**
 * Names for the currency picker, in the reader's own language.
 *
 * These come from `Intl.DisplayNames` rather than the message bundles on
 * purpose: CLDR already ships every currency name in every locale DiveDay
 * carries, so hand-translating twenty-odd of them into the staff bundle would be
 * copying a translation table into a file people then have to keep in sync.
 * The same reasoning `src/i18n/rental-labels.ts` applies to domain codes —
 * resolve labels in `src/i18n/`, never in `src/lib`/`src/db`.
 */
export function currencyLabel(currency: string, locale = "en-US"): string {
  const code = currency.toUpperCase();
  const name = cachedDisplayNames(locale, { type: "currency" }).of(code);
  // `of()` returns the code back when the runtime has no name for it; showing
  // "USD — USD ($)" would be silly, so collapse to the code and symbol.
  if (!name || name === code) return `${code} (${currencySymbol(currency, locale)})`;
  return `${code} — ${name} (${currencySymbol(currency, locale)})`;
}

/**
 * The picker's options, sorted by the reader's collation so a Spanish-reading
 * owner doesn't get an English alphabetical order. `SHOP_CURRENCIES`' own
 * order is deliberately not used — it lists USD first for the default, which
 * is not a useful ordering once there are twenty of them.
 */
export function currencyOptions(locale = "en-US"): Array<{ value: ShopCurrency; label: string }> {
  const collator = cachedCollator(locale);
  return SHOP_CURRENCIES.map((value) => ({ value, label: currencyLabel(value, locale) })).sort(
    (a, b) => collator.compare(a.label, b.label),
  );
}
