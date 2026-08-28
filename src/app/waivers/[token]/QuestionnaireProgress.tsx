"use client";

import { ProgressBar } from "@/components/ui/ProgressBar";
import { fill, pluralForm } from "@/i18n/fill";
import { useMedicalDraftCount } from "./WaiverPacing";

/**
 * A sticky "N of M answered" bar over the medical questionnaire — a dock, on a
 * phone, mid-scroll has no other way to see how much is left before the
 * signature at the bottom.
 *
 * **It counts; it does not judge.** The line words facts only — how many of the
 * questions the diver was handed are answered — and never a clearance, which is
 * the waiver and medical wording freeze (H-01/H-03). What the answers *mean* is
 * `QuestionnaireOutcome`'s single sentence under the questions, and nowhere
 * else on the page.
 *
 * Only the **page-one** questions are counted (`data-question-scope="primary"`,
 * stamped by `MedicalQuestionnaireFields`). The bar used to count every radio
 * on screen, which meant it opened at "0 of 11" — the ten numbered questions
 * plus the dental check — against a form that asks ten, and then climbed as a
 * diver's own yes answers opened Boxes, so answering a question could make the
 * remaining work look *longer*. It is a measure of the fixed list the diver was
 * handed, not a completeness gate: the follow-ups a yes opens are still
 * `required` on their own radios, and the outcome line under the questions is
 * what says a Box is still open.
 *
 * The count itself is owned by {@link WaiverPacing}, which wraps the whole page
 * so the step rail above the release can read the same number (ADR
 * 20260827-the-divers-thread, decision 5). It used to be owned here, back when
 * this was the only thing on the page that needed it; two components deriving
 * one count from the same radios is how they drift.
 *
 * `labelTemplate` is a whole, already-translated sentence with `{answered}`/
 * `{total}` placeholders (`waiver.questionsAnswered*`), resolved server-side by
 * `diverTranslator` and filled in here with the live counts — this page has no
 * `DiverIntlProvider`, so a Client Component on it cannot call
 * `useTranslations()` itself. Same `fill()`-template pattern as
 * `ScheduleBuilder.tsx`'s `BuilderCopy`.
 */
export function QuestionnaireProgress({
  total,
  labelTemplateOne,
  labelTemplateOther,
  children,
}: {
  /** Server-known total, and the denominator until the provider's count lands. */
  total: number;
  labelTemplateOne: string;
  labelTemplateOther: string;
  children: React.ReactNode;
}) {
  const draft = useMedicalDraftCount();
  const answered = draft?.answered ?? 0;
  const questionTotal = draft?.total ?? total;
  const percent = questionTotal === 0 ? 0 : Math.min(100, (answered / questionTotal) * 100);

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-2">
        {/* Announces the running count, not the click that changed it — one
            polite region a diver revisiting an already-answered question
            doesn't re-trigger a screen-reader interruption for. */}
        <p role="status" className="text-sm font-medium text-muted">
          {fill(
            pluralForm(
              questionTotal,
              { one: labelTemplateOne, other: labelTemplateOther },
              draft?.locale,
            ),
            {
              answered,
              total: questionTotal,
            },
          )}
        </p>
        <ProgressBar
          className="mt-1.5 h-1.5"
          segments={[{ key: "answered", fraction: percent / 100, className: "bg-primary" }]}
        />
      </div>
      {children}
    </div>
  );
}
