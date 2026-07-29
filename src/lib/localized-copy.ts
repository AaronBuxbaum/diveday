/**
 * Copy stored in a shop's own language without making English a data-model
 * invariant. A string keeps existing rows and APIs compatible; the keyed form
 * is the migration-safe shape for a future translation editor.
 */
export type LocalizedCopy = string | Record<string, string>;

export function copyForLocale(
  value: LocalizedCopy | null | undefined,
  locale: string,
  fallbackLocale = "en-US",
): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value[locale] ?? value[fallbackLocale] ?? Object.values(value)[0] ?? "";
}

export function localizedCopy(value: string, locale = "en-US"): Record<string, string> {
  return { [locale]: value };
}
