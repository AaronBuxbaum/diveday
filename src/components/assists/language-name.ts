import { cachedDisplayNames } from "@/lib/intl-cache";

/**
 * A language code ("de") in the reader's own words ("German", "alemán"), for
 * the lines that say a message was translated. Null for a code `Intl` does not
 * know, so the line is left out rather than naming a code.
 */
export function languageName(code: string | null | undefined, locale: string): string | null {
  if (!code) return null;
  try {
    return cachedDisplayNames(locale, { type: "language", fallback: "none" }).of(code) ?? null;
  } catch {
    return null;
  }
}
