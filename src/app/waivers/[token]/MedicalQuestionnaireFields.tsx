"use client";

import { useMemo, useState } from "react";
import type { MedicalQuestion, MedicalQuestionnaire } from "@/lib/medical";

function RadioQuestion({
  question,
  answer,
  yesLabel,
  noLabel,
  reassurance,
  onAnswer,
}: {
  question: MedicalQuestion;
  answer: boolean | undefined;
  yesLabel: string;
  noLabel: string;
  reassurance: string;
  onAnswer: (id: string, value: boolean) => void;
}) {
  return (
    <fieldset className="rounded-lg border border-border bg-surface p-4">
      <legend className="px-1 text-base font-medium">{question.prompt}</legend>
      <div className="mt-3 flex gap-3">
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-base hover:bg-surface-sunken">
          <input
            type="radio"
            name={`q_${question.id}`}
            value="yes"
            checked={answer === true}
            onChange={() => onAnswer(question.id, true)}
            required
          />
          {yesLabel}
        </label>
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-base hover:bg-surface-sunken">
          <input
            type="radio"
            name={`q_${question.id}`}
            value="no"
            checked={answer === false}
            onChange={() => onAnswer(question.id, false)}
            required
          />
          {noLabel}
        </label>
      </div>
      {answer === true ? <p className="mt-3 text-sm text-muted">{reassurance}</p> : null}
    </fieldset>
  );
}

export function MedicalQuestionnaireFields({
  questionnaire,
  initialResponses,
  yesLabel,
  noLabel,
  reassurance,
}: {
  questionnaire: MedicalQuestionnaire;
  initialResponses?: Readonly<Record<string, boolean>>;
  yesLabel: string;
  noLabel: string;
  reassurance: string;
}) {
  const [responses, setResponses] = useState<Record<string, boolean>>(() => ({
    ...(initialResponses ?? {}),
  }));
  const primary = questionnaire.questions.filter((question) => question.section === "primary");
  const dental = questionnaire.questions.filter((question) => question.section === "dental");
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
          yesLabel={yesLabel}
          noLabel={noLabel}
          reassurance={reassurance}
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
                yesLabel={yesLabel}
                noLabel={noLabel}
                reassurance={reassurance}
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
      {dental.length ? (
        <section className="mt-3 flex flex-col gap-3 border-t border-border pt-4">
          {dental.map((question) => (
            <RadioQuestion
              key={question.id}
              question={question}
              answer={responses[question.id]}
              yesLabel={yesLabel}
              noLabel={noLabel}
              reassurance={reassurance}
              onAnswer={answer}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}
