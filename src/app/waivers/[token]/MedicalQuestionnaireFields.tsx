"use client";

import { useMemo, useState } from "react";
import type { MedicalQuestion, MedicalQuestionnaire } from "@/lib/medical";
import { medicalProgress, medicalQuestionField } from "@/lib/medical";

/**
 * Every word this component renders, resolved server-side. The waiver page has
 * no `DiverIntlProvider` over it, so a Client Component here cannot call
 * `useTranslations()` for itself.
 */
export type MedicalQuestionnaireCopy = {
  yesLabel: string;
  noLabel: string;
  /** Shown under a yes that genuinely means a physician has to sign off. */
  referralReassurance: string;
  /** Shown under a yes that only opens a Box of follow-up questions. */
  followUpReassurance: string;
  outcomeClear: string;
  outcomeReferral: string;
  outcomeFollowUpsOpen: string;
};

function RadioQuestion({
  question,
  answer,
  copy,
  onAnswer,
}: {
  question: MedicalQuestion;
  answer: boolean | undefined;
  copy: MedicalQuestionnaireCopy;
  onAnswer: (id: string, value: boolean) => void;
}) {
  // The published form marks with an asterisk the questions where a yes is
  // itself a referral (3, 5 and 10, every Box question, and the dental one). On
  // the other seven primaries a yes only opens a Box, so telling that diver "a
  // doctor should confirm you're fit to dive" states a consequence that has not
  // happened and may never — the 2026-08-06 review's finding.
  const reassurance = question.referral ? copy.referralReassurance : copy.followUpReassurance;
  return (
    <fieldset className="rounded-lg border border-border bg-surface p-4">
      <legend className="px-1 text-base font-medium">{question.prompt}</legend>
      <div className="mt-3 flex gap-3">
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-base hover:bg-surface-sunken">
          <input
            type="radio"
            name={medicalQuestionField(question.id)}
            // Read by `QuestionnaireProgress`, which counts the page-one
            // questions the diver was asked up front separately from the
            // follow-ups their own answers open (`data-*` rather than parsing
            // ids, which are the published form's numbering, not a contract).
            data-question-scope={question.section === "primary" ? "primary" : "follow-up"}
            value="yes"
            checked={answer === true}
            onChange={() => onAnswer(question.id, true)}
            required
          />
          {copy.yesLabel}
        </label>
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-base hover:bg-surface-sunken">
          <input
            type="radio"
            name={medicalQuestionField(question.id)}
            data-question-scope={question.section === "primary" ? "primary" : "follow-up"}
            value="no"
            checked={answer === false}
            onChange={() => onAnswer(question.id, false)}
            required
          />
          {copy.noLabel}
        </label>
      </div>
      {answer === true ? <p className="mt-3 text-sm text-muted">{reassurance}</p> : null}
    </fieldset>
  );
}

/**
 * What the answers so far add up to, stated at the moment it becomes true.
 *
 * This replaces the published form's directions paragraph, which asked the
 * diver to memorise which question numbers carry an asterisk and then apply
 * the rule to themselves. Nothing here is a gate: `outcomeReferral` explicitly
 * tells the diver to finish and sign, because a referral is a piece of paper
 * their doctor provides later, not a refusal of the waiver.
 */
function QuestionnaireOutcome({
  questionnaire,
  responses,
  copy,
}: {
  questionnaire: MedicalQuestionnaire;
  responses: Readonly<Record<string, boolean | undefined>>;
  copy: MedicalQuestionnaireCopy;
}) {
  const { outcome } = medicalProgress(questionnaire, responses);
  const text =
    outcome === "referral"
      ? copy.outcomeReferral
      : outcome === "clear"
        ? copy.outcomeClear
        : outcome === "follow_ups_open"
          ? copy.outcomeFollowUpsOpen
          : null;
  if (!text) return null;
  const tone =
    outcome === "clear"
      ? "border-success/40 bg-success-tint text-success-strong"
      : outcome === "referral"
        ? "border-warning/40 bg-warning-tint text-warning-strong"
        : "border-border bg-surface-sunken text-muted";
  return (
    // Polite, not assertive: this changes on nearly every answer, and a diver
    // working down the form should not be interrupted mid-question each time.
    <p role="status" className={`mt-1 rounded-lg border px-4 py-3 text-sm font-medium ${tone}`}>
      {text}
    </p>
  );
}

export function MedicalQuestionnaireFields({
  questionnaire,
  initialResponses,
  copy,
}: {
  questionnaire: MedicalQuestionnaire;
  initialResponses?: Readonly<Record<string, boolean>>;
  copy: MedicalQuestionnaireCopy;
}) {
  const [responses, setResponses] = useState<Record<string, boolean>>(() => ({
    ...(initialResponses ?? {}),
  }));
  const primary = questionnaire.questions.filter((question) => question.section === "primary");
  const byParent = useMemo(() => {
    const result = new Map<string, MedicalQuestion[]>();
    for (const question of questionnaire.questions) {
      if (!question.parentId) continue;
      const list = result.get(question.parentId) ?? [];
      list.push(question);
      result.set(question.parentId, list);
    }
    return result;
  }, [questionnaire.questions]);

  function answer(id: string, value: boolean) {
    setResponses((previous) => {
      const next = { ...previous, [id]: value };
      // A branch that is closed is not applicable; clear stale child values so
      // a changed answer can never carry a hidden yes into the result.
      if (value === false) {
        for (const child of questionnaire.questions.filter(
          (question) => question.parentId === id,
        )) {
          next[child.id] = false;
        }
      }
      return next;
    });
  }

  function renderQuestion(question: MedicalQuestion) {
    const children = byParent.get(question.id) ?? [];
    return (
      <div key={question.id} className="flex flex-col gap-3">
        <RadioQuestion
          question={question}
          answer={responses[question.id]}
          copy={copy}
          onAnswer={answer}
        />
        {question.boxSection && responses[question.id] === true ? (
          <section className="ml-3 flex flex-col gap-3 border-l-2 border-primary/30 pl-4">
            <h3 className="text-sm font-semibold tracking-wide text-muted">
              {questionnaire.boxes?.find((box) => box.section === question.boxSection)?.title}
            </h3>
            {children.map((child) => (
              <RadioQuestion
                key={child.id}
                question={child}
                answer={responses[child.id]}
                copy={copy}
                onAnswer={answer}
              />
            ))}
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      {primary.map(renderQuestion)}
      <QuestionnaireOutcome questionnaire={questionnaire} responses={responses} copy={copy} />
    </div>
  );
}
