import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { DIVER_LOCALES } from "@/i18n/settings";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { questionnaireForJurisdiction } from "@/lib/medical";
import {
  parseHealthWords,
  SHOP_CHOICE_OPTION_MAX,
  SHOP_QUESTION_PROMPT_MAX,
  SHOP_QUESTIONS_MAX,
} from "@/lib/waiver-questions";
import type { ShopQuestionsCopy } from "./ShopQuestionsEditor";

/** Every word `ShopQuestionsEditor` renders, in the reader's language. */
export function shopQuestionsCopy(t: StaffTranslator): ShopQuestionsCopy {
  return {
    heading: t("waiversStaff.questions.heading"),
    intro: t("waiversStaff.questions.intro"),
    alreadyAsked: t("waiversStaff.questions.alreadyAsked"),
    optionalAdvice: t("waiversStaff.questions.optionalAdvice"),
    empty: t("waiversStaff.questions.empty"),
    add: t("waiversStaff.questions.add"),
    full: t("waiversStaff.questions.full", { max: SHOP_QUESTIONS_MAX }),
    promptLabel: t("waiversStaff.questions.promptLabel"),
    kindLabel: t("waiversStaff.questions.kindLabel"),
    kinds: {
      yes_no: t("waiversStaff.questions.kind.yesNo"),
      text: t("waiversStaff.questions.kind.text"),
      number: t("waiversStaff.questions.kind.number"),
      date: t("waiversStaff.questions.kind.date"),
      choice: t("waiversStaff.questions.kind.choice"),
    },
    requiredLabel: t("waiversStaff.questions.requiredLabel"),
    optionsLabel: t("waiversStaff.questions.optionsLabel"),
    optionsHint: t("waiversStaff.questions.optionsHint"),
    moveUp: t("waiversStaff.questions.moveUp"),
    moveDown: t("waiversStaff.questions.moveDown"),
    delete: t("waiversStaff.questions.delete"),
    healthWarning: t("waiversStaff.questions.healthWarning"),
    questionLabel: t.raw("waiversStaff.questions.questionLabel") as string,
    problems: {
      promptEmpty: t("waiversStaff.questions.problem.promptEmpty"),
      promptTooLong: t("waiversStaff.questions.problem.promptTooLong", {
        max: SHOP_QUESTION_PROMPT_MAX,
      }),
      optionsCount: t("waiversStaff.questions.problem.optionsCount"),
      optionTooLong: t("waiversStaff.questions.problem.optionTooLong", {
        max: SHOP_CHOICE_OPTION_MAX,
      }),
      duplicateOption: t("waiversStaff.questions.problem.duplicateOption"),
      controlCharacter: t("waiversStaff.questions.problem.controlCharacter"),
    },
  };
}

/**
 * The health words a prompt is warned about, from every locale's bundle: a
 * prompt may be written in either language whatever the reader's is.
 */
export function shopQuestionHealthWords(): string[] {
  return [
    ...new Set(
      DIVER_LOCALES.flatMap((bundle) =>
        parseHealthWords(staffTranslator(bundle)("waiversStaff.questions.healthWords")),
      ),
    ),
  ];
}

/**
 * The standard medical questionnaire, collapsed and read-only, above "Your
 * questions" (glossary *Shop question*), so a shop sees what is already asked
 * and does not rebuild it. The editor itself is drawn by `ReleaseForm`, which
 * owns the form a refusal hands back to.
 */
export function StandardQuestionnaire({
  jurisdiction,
  t,
}: {
  jurisdiction: Parameters<typeof questionnaireForJurisdiction>[0];
  t: StaffTranslator;
}) {
  const questionnaire = questionnaireForJurisdiction(jurisdiction);
  return (
    <details className="group/medical rounded-lg border border-border px-4 py-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
        {t("waiversStaff.questions.standardSummary")}
        <DisclosureCaret className="group-open/medical:rotate-90" />
      </summary>
      <p className="mt-2 text-sm text-muted">{t("waiversStaff.questions.standardStays")}</p>
      <ol className="mt-2 list-decimal space-y-1 ps-5 text-sm text-muted">
        {questionnaire.questions
          .filter((question) => question.section === "primary")
          .map((question) => (
            <li key={question.id}>{question.prompt}</li>
          ))}
      </ol>
    </details>
  );
}
