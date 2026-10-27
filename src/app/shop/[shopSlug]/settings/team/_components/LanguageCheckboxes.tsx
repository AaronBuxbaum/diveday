import { ChoicePill } from "@/components/ui/form";
import { languageNameIn } from "@/i18n/language-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { cachedListFormat } from "@/lib/intl-cache";
import { COMMON_SPOKEN_LANGUAGES } from "@/lib/spoken-languages";

export function StaffLanguagesValue({
  languages,
  locale,
  t,
}: {
  languages: readonly string[];
  locale: string;
  t: StaffTranslator;
}) {
  const names = languages.map((language) => languageNameIn(language, locale) ?? language);
  return names.length > 0 ? (
    cachedListFormat(locale).format(names)
  ) : (
    <span className="print:hidden">{t("settings.team.emergencyContact.addValue")}</span>
  );
}

/**
 * One staff member's spoken languages (issue #708) — a checkbox per language
 * DiveDay can render, each labelled in the *reader's* own language
 * (`languageNameIn`) so the staffer filling this in recognises the option,
 * unlike the diver-facing badge below which uses each language's endonym.
 */
export function LanguageCheckboxes({
  defaultLanguages,
  locale,
  t,
}: {
  defaultLanguages: readonly string[];
  locale: string;
  t: StaffTranslator;
}) {
  return (
    <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <legend className="sr-only">{t("settings.team.languagesLegend")}</legend>
      {COMMON_SPOKEN_LANGUAGES.map((language) => (
        <ChoicePill
          key={language}
          type="checkbox"
          name={`language_${language}`}
          defaultChecked={defaultLanguages.includes(language)}
        >
          {languageNameIn(language, locale) ?? language}
        </ChoicePill>
      ))}
    </fieldset>
  );
}
