import { languageEndonymList } from "@/i18n/language-labels";
import { cachedListFormat } from "@/lib/intl-cache";

/**
 * The languages the departure's crew speak, each in its own name, joined the
 * reader's way ("English, Español and Deutsch"); null when nobody has said.
 */
export function crewLanguagesSentence(
  crewLanguages: Parameters<typeof languageEndonymList>[0],
  locale: string,
): string | null {
  const names = languageEndonymList(crewLanguages);
  return names.length === 0
    ? null
    : cachedListFormat(locale, { style: "long", type: "conjunction" }).format(names);
}
