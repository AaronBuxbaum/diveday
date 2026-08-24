/**
 * The set of languages a shop can record a staff member speaking
 * (`people.spoken_languages`, issue #708) — BCP-47 primary-language tags, not
 * free text, so both the diver-facing badge and the staff-side coverage
 * signal can render and compare them without parsing prose.
 *
 * Deliberately a fixed, curated list rather than every tag CLDR knows: a
 * checkbox per language only works at a size a person can scan, and this is
 * sized for a shop selling to international divers — the working languages
 * of recreational diving's biggest source markets and the languages spoken
 * where those divers actually travel to dive. Not exhaustive, and not meant
 * to be; a shop whose crew speaks a language not on this list has no way to
 * record it yet, which is a real gap and a smaller, separate change from
 * this one.
 */
export const COMMON_SPOKEN_LANGUAGES = [
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "nl",
  "sv",
  "ru",
  "pl",
  "zh",
  "ja",
  "ko",
  "ar",
  "he",
  "tr",
] as const;

export type SpokenLanguageTag = (typeof COMMON_SPOKEN_LANGUAGES)[number];

export function isSpokenLanguageTag(value: string): value is SpokenLanguageTag {
  return (COMMON_SPOKEN_LANGUAGES as readonly string[]).includes(value);
}
