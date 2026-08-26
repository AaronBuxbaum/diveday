import { cachedDisplayNames } from "@/lib/intl-cache";

/**
 * Names for languages, resolved from CLDR rather than from a message bundle —
 * the same reasoning `src/i18n/currency-labels.ts` applies to currency names.
 * Every locale DiveDay carries already ships every language's name; hand-writing
 * them into `diver.json` would be copying a translation table into a file people
 * then have to keep in sync, and it could only ever cover the languages someone
 * remembered to add.
 */

/** The two language names a fallback notice needs, already resolved for display. */
export type LanguageFallback = {
  /** What the visitor asked for, in their own language — "Deutsch", "日本語". */
  requested: string;
  /** What they are being shown, in that language — "English", "español". */
  shown: string;
};

/**
 * A language's own name for itself — `"de"` → "Deutsch", `"ja"` → "日本語".
 *
 * The endonym, deliberately, and it is the whole reason this helper exists.
 * The unsupported-language notice (review finding I18N-L1) is written in a
 * language its reader by definition does not read, so the one token that has
 * to land is the name of *their* language. "Deutsch" is recognisable to
 * someone who cannot read the sentence around it; "German" is not.
 *
 * `code` must be a structurally valid language subtag — `unsupportedLanguage`
 * in ./negotiate.ts is what guarantees that for header-derived values. Returns
 * null when the runtime has no name for the code (`of()` hands the code back),
 * so a caller can decide whether a bare tag is worth showing.
 */
export function languageEndonym(code: string): string | null {
  const name = cachedDisplayNames(code, { type: "language" }).of(code);
  return !name || name === code ? null : name;
}

/**
 * Distinct language names written in each language's own words, suitable for
 * an aggregate availability line such as a shop's languages or a trip's
 * current crew languages. A raw tag is intentionally not a fallback here: a
 * diver can act on a name they recognise, not an implementation code.
 */
export function languageEndonymList(codes: readonly string[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const code of codes) {
    if (seen.has(code)) continue;
    seen.add(code);
    const name = languageEndonym(code);
    if (name) names.push(name);
  }
  return names;
}

/**
 * A language's name in `locale` — `("en", "es-ES")` → "inglés". Used for the
 * language the page is actually rendered in, which is by definition a language
 * the reader is being shown, so it is named in that language rather than in
 * theirs.
 */
export function languageNameIn(code: string, locale: string): string | null {
  const name = cachedDisplayNames(locale, { type: "language" }).of(code);
  return !name || name === code ? null : name;
}

/**
 * A locale's name for itself, ready to put on a switcher — `"en-US"` →
 * "English", `"es-ES"` → "Español".
 *
 * The *primary subtag* is what gets named, not the whole tag: CLDR renders
 * `en-US` as "American English" and `es-ES` as "español de España", which is
 * accurate and useless on a two-item menu — DiveDay carries one bundle per
 * language, so the region is an implementation detail of which bundle, never a
 * choice the reader is making. Falls back to the tag itself if the runtime has
 * no name at all, which is still better than a blank button.
 *
 * **Sentence-cased, and only here.** CLDR follows each language's own
 * orthography, and Spanish does not capitalise the names of languages while
 * English does — so the raw endonyms put "English" beside "español" on the same
 * two-button switcher, which reads as one of them being broken rather than as a
 * point of grammar. A switcher label is a *name on a control*, the position
 * where both languages capitalise, so the first letter is raised through the
 * label's own locale (`toLocaleUpperCase`, not `toUpperCase` — Turkish dotted
 * i, should a Turkish bundle ever land). Everything mid-sentence keeps CLDR's
 * casing: `languageEndonym` and `languageNameIn` above are untouched, because
 * "…no está en español todavía" must not grow a capital.
 *
 * Not flags. A flag is a country, and a language is not: Spanish is not Spain
 * (the great majority of its speakers are in the Americas, and DiveDay's launch
 * shops sell to them), English is neither the US nor the UK, and no single
 * banner can stand for either without telling some reader this app is not for
 * them. The name of the language, written the way that language writes it, is
 * the one label every reader of it recognises.
 */
export function localeEndonym(locale: string): string {
  const language = locale.split("-")[0];
  const name = languageNameIn(language, locale) ?? languageEndonym(language) ?? locale;
  // `[...name]` splits by code point, so a first letter outside the BMP is
  // raised whole rather than by its leading surrogate half.
  const [first, ...rest] = [...name];
  return first ? `${first.toLocaleUpperCase(locale)}${rest.join("")}` : name;
}
