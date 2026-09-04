"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MedicalQuestion, MedicalQuestionnaire } from "@/lib/medical";
import { applicableResponsesOnly, medicalProgress, medicalQuestionField } from "@/lib/medical";

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
  // These stay uncontrolled, as a real paper-like form should: a diver can
  // answer before its JavaScript finishes loading and hydration must not erase
  // that choice. The parent reconciles the live DOM once into its state so
  // dynamic Boxes and the outcome line learn the same answer.
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
            defaultChecked={answer === true}
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
            defaultChecked={answer === false}
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
  const rootRef = useRef<HTMLDivElement>(null);
  // **Pruned on the way in**, not trusted as given (issue #1135). A draft is
  // restored through here, and a draft written before this rule existed carries
  // an explicit `false` for every child of every unanswered Box. Seeded like
  // that, a later honest yes opens the Box with its questions already answered
  // and `answer()` never runs, because the value going in is `true`.
  const [responses, setResponses] = useState<Record<string, boolean>>(() =>
    applicableResponsesOnly(questionnaire, initialResponses ?? {}),
  );
  const primary = questionnaire.questions.filter((question) => question.section === "primary");
  const questionIdByField = useMemo(
    () =>
      new Map(
        questionnaire.questions.map((question) => [medicalQuestionField(question.id), question.id]),
      ),
    [questionnaire.questions],
  );
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

  useEffect(() => {
    // Server HTML remains usable before this component hydrates. Reconcile any
    // choice made in that interval, so neither the answer nor a Box it opens
    // disappears when JavaScript arrives.
    const root = rootRef.current;
    if (root) {
      const selected = new Map<string, boolean>();
      for (const input of root.querySelectorAll<HTMLInputElement>('input[type="radio"]:checked')) {
        const questionId = questionIdByField.get(input.name);
        if (questionId) selected.set(questionId, input.value === "yes");
      }
      if (selected.size > 0) {
        setResponses((previous) => {
          const merged = { ...previous };
          let changed = false;
          for (const [questionId, answer] of selected) {
            if (merged[questionId] !== answer) {
              merged[questionId] = answer;
              changed = true;
            }
          }
          if (!changed) return previous;
          // **Pruned after the merge**, because this is the third door into the
          // response map and it bypasses `answer()` entirely (issue #1135). The
          // sequence it closes: a Box is server-rendered open with its children
          // checked, the diver taps the parent "no" before hydration — nothing
          // hides, so the children are still checked in the DOM — and this
          // effect then harvests all five. Render closes the Box; state would
          // otherwise keep the children, and reopening would show them back.
          return applicableResponsesOnly(questionnaire, merged);
        });
      }
    }
  }, [questionIdByField, questionnaire]);

  function answer(id: string, value: boolean) {
    setResponses((previous) => {
      const next = { ...previous, [id]: value };
      // A branch that is *closing* is not applicable; drop its child answers so
      // a changed answer can never carry a hidden yes into the result, and so a
      // reopened Box asks again rather than opening pre-filled.
      //
      // **`delete`, not `= false`** (issue #1135, owner ruling 2026-09-02). The
      // sequence: a diver answers yes to "I am over 45 years of age", works
      // through Box B's four cardiac questions, changes their mind, sets it to
      // no, then back to yes. Writing `false` reopened the Box with all four
      // already answered — the diver's own answers, but ones they had not
      // looked at since, and the next thing they do is sign. Deleting leaves
      // them blank, and each radio's own `required` attribute then holds the
      // signature until they are answered again.
      //
      // The cost is real and was weighed: `medicalProgress` counts a blank
      // follow-up as remaining, so the rail's Medical step reopens and the
      // outcome line drops back to `follow_ups_open` on every parent toggle.
      // That falls only on a diver who changes their mind twice. Nothing
      // reaching a signed medical record should be a value its signer has not
      // seen in its final state.
      //
      // `previous[id] === true` is the other half of the rule: only a branch
      // that was open has children the diver has seen. Without it, every no on
      // a page-one question wrote a no into the children of a Box that had
      // never been opened — answering no to all ten primaries silently filled
      // Box B's four questions, so `medicalProgress` counted zero follow-ups
      // remaining, the outcome line read `outcomeClear`, and four answers the
      // diver never read went into the signed record.
      if (value === false && previous[id] === true) {
        for (const child of questionnaire.questions.filter(
          (question) => question.parentId === id,
        )) {
          delete next[child.id];
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
    <div ref={rootRef} className="mt-4 flex flex-col gap-3">
      {primary.map(renderQuestion)}
      <QuestionnaireOutcome questionnaire={questionnaire} responses={responses} copy={copy} />
    </div>
  );
}
