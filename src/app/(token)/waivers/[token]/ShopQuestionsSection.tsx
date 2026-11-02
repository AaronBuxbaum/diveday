import {
  ChoicePill,
  controlClass,
  DateField,
  Field,
  FieldGrid,
  FormStatus,
} from "@/components/ui/form";
import type { DiverTranslator } from "@/i18n/messages";
import {
  type DraftShopAnswers,
  SHOP_ANSWER_TEXT_MAX,
  type ShopQuestion,
  shopAnswerField,
} from "@/lib/waiver-questions";
import { SectionHeading } from "./SectionHeading";

/** The same-page anchor of one shop question: what a refusal rings and the rail points at. */
export function shopQuestionAnchor(questionId: string): string {
  return `shop-question-${questionId}`;
}

/** The section's own anchor, for the rail and a refusal with no question named. */
export const SHOP_QUESTIONS_ANCHOR = "shop-questions";

/**
 * **"Questions from {shop}"** (glossary *Shop question*): the shop's own
 * questions, after the medical questionnaire and the emergency contact and
 * before the signature, on a release whose version asks any.
 *
 * Kept visibly apart from the medical form (dive-domain review C4): its own
 * heading, no numbering that continues the questionnaire's, its own step on
 * the rail, and nothing here counts toward the medical step. No answer is
 * pre-selected for any kind; a saved draft fills in only what the diver gave,
 * already re-validated against these questions. A required question is
 * answered, never answered a particular way: the server reads answers by id
 * against the record's own version and builds the sealed snapshot itself.
 */
export function ShopQuestionsSection({
  questions,
  draft,
  shopName,
  minorName,
  refused,
  t,
}: {
  questions: readonly ShopQuestion[];
  draft: DraftShopAnswers;
  shopName: string;
  /** The diver's name on a minor's release, where a guardian is answering about them. */
  minorName: string | null;
  /** The question a refused submit named, with the words to show under it. */
  refused: { questionId: string; text: string } | undefined;
  t: DiverTranslator;
}) {
  if (questions.length === 0) return null;
  return (
    <section id={SHOP_QUESTIONS_ANCHOR} className="scroll-mt-24">
      <SectionHeading>{t("waiver.shopQuestionsHeading", { shop: shopName })}</SectionHeading>
      <p className="mt-2 text-sm text-muted">
        {minorName
          ? t("waiver.shopQuestionsIntroMinor", { name: minorName, shop: shopName })
          : t("waiver.shopQuestionsIntro", { shop: shopName })}
      </p>
      {/* Never a gate: one line sending health back to the questionnaire,
          which refers a diver to a doctor, because an answer here is never
          read as a disclosure (dive-domain review 1, S4). */}
      <p className="mt-1 text-sm text-muted">{t("waiver.shopQuestionsHealthNote")}</p>
      <ul className="mt-4 divide-y divide-border border-y border-border">
        {questions.map((question) => (
          <li key={question.id} className="py-4">
            <ShopQuestionControl
              question={question}
              value={draft[question.id]}
              error={refused?.questionId === question.id ? refused.text : undefined}
              t={t}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ShopQuestionControl({
  question,
  value,
  error,
  t,
}: {
  question: ShopQuestion;
  value: DraftShopAnswers[string] | undefined;
  error: string | undefined;
  t: DiverTranslator;
}) {
  const name = shopAnswerField(question.id);
  const anchor = shopQuestionAnchor(question.id);
  const hint = question.required ? undefined : t("common.optional");
  // Read by `WaiverPacing`, which settles the Questions step once nothing
  // required is blank.
  const requiredMark = question.required ? { "data-shop-question-required": "" } : {};

  if (question.kind === "yes_no" || question.kind === "choice") {
    const choices =
      question.kind === "yes_no"
        ? [
            { value: "yes", label: t("waiver.answerYes"), checked: value === true },
            { value: "no", label: t("waiver.answerNo"), checked: value === false },
          ]
        : (question.options ?? []).map((option) => ({
            value: option,
            label: option,
            checked: value === option,
          }));
    const errorId = error ? `${anchor}-error` : undefined;
    return (
      // A fieldset named by its prompt, as the medical questions are, and the
      // control a refusal rings (`FieldErrorFocus` gives it a tab stop).
      <fieldset
        id={anchor}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={errorId}
        className="rounded-lg"
      >
        <legend className="float-left mb-2 w-full p-0 text-base font-medium text-pretty">
          {question.prompt}
          {hint ? <span className="font-normal text-muted"> {hint}</span> : null}
        </legend>
        <div className="clear-both flex flex-wrap gap-3">
          {choices.map((choice) => (
            <ChoicePill
              key={choice.value}
              type="radio"
              size="md"
              name={name}
              value={choice.value}
              defaultChecked={choice.checked}
              required={question.required}
              {...requiredMark}
            >
              {choice.label}
            </ChoicePill>
          ))}
        </div>
        {error ? (
          <FormStatus id={errorId} className="mt-2">
            {error}
          </FormStatus>
        ) : null}
      </fieldset>
    );
  }

  const defaultValue = value === undefined ? "" : String(value);
  return (
    <FieldGrid columns={1}>
      <Field label={question.prompt} hint={hint} error={error}>
        {question.kind === "date" ? (
          <DateField
            id={anchor}
            name={name}
            required={question.required}
            defaultValue={defaultValue}
            {...requiredMark}
          />
        ) : question.kind === "number" ? (
          <input
            id={anchor}
            name={name}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="off"
            required={question.required}
            defaultValue={defaultValue}
            className={controlClass}
            {...requiredMark}
          />
        ) : (
          <input
            id={anchor}
            name={name}
            maxLength={SHOP_ANSWER_TEXT_MAX}
            autoComplete="off"
            required={question.required}
            defaultValue={defaultValue}
            className={controlClass}
            {...requiredMark}
          />
        )}
      </Field>
    </FieldGrid>
  );
}
