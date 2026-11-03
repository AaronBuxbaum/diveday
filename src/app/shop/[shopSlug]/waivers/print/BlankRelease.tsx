import type { ReactNode } from "react";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { MedicalQuestion, MedicalQuestionnaire } from "@/lib/medical";
import type { ShopQuestion } from "@/lib/waiver-questions";

/** Every word the blank release prints that is DiveDay's, in the reader's language. */
export type BlankReleaseCopy = {
  version: string;
  medicalHeading: string;
  yes: string;
  no: string;
  followUp: string;
  shopHeading: string;
  signatureHeading: string;
  printedName: string;
  diverSignature: string;
  guardianName: string;
  guardianSignature: string;
  guardianNote: string;
  date: string;
};

/** An empty box. Never ticked: this page prints a form, not an answer. */
function Box({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className="inline-block size-4 border-2 border-foreground" />
      {label}
    </span>
  );
}

function Line({ label }: { label: string }) {
  return (
    <div className="mt-6 border-b border-foreground pb-1">
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}

function YesNo({ copy }: { copy: Pick<BlankReleaseCopy, "yes" | "no"> }) {
  return (
    <span className="flex shrink-0 gap-4 text-sm">
      <Box label={copy.yes} />
      <Box label={copy.no} />
    </span>
  );
}

function MedicalRow({
  number,
  question,
  copy,
}: {
  number: string;
  question: MedicalQuestion;
  copy: BlankReleaseCopy;
}) {
  return (
    <li className="flex break-inside-avoid items-start justify-between gap-4 py-2">
      <p className="min-w-0 text-sm">
        <span className="font-medium">{number}</span> {question.prompt}
      </p>
      <YesNo copy={copy} />
    </li>
  );
}

function ShopQuestionRow({
  number,
  question,
  copy,
}: {
  number: number;
  question: ShopQuestion;
  copy: BlankReleaseCopy;
}) {
  let answer: ReactNode;
  if (question.kind === "yes_no") {
    answer = <YesNo copy={copy} />;
  } else if (question.kind === "choice") {
    answer = (
      <ul className="mt-2 space-y-1 text-sm">
        {(question.options ?? []).map((option) => (
          <li key={option}>
            <Box label={option} />
          </li>
        ))}
      </ul>
    );
  } else {
    answer = <div className="mt-6 border-b border-foreground" />;
  }
  return (
    <li className="break-inside-avoid py-2">
      <div className="flex items-start justify-between gap-4">
        <p className="min-w-0 text-sm">
          <span className="font-medium">{number}.</span> {question.prompt}
        </p>
        {question.kind === "yes_no" ? answer : null}
      </div>
      {question.kind === "yes_no" ? null : answer}
    </li>
  );
}

/**
 * **A release on paper, with nothing answered** (issue #2972): the live
 * release text, the standard medical questionnaire with empty yes/no boxes,
 * the shop's own questions with blanks, and the signature lines, over the
 * version number so a counter's paper can be matched to the version recorded
 * for it. Pure: the page reads, this prints.
 *
 * The release and questionnaire words are the ones divers sign online, in the
 * language they were published in (H-20260730-jurisdiction-waiver-text-medical, H-20260724-current-typed-name-explicit); only the form's furniture is
 * translated.
 */
export function BlankRelease({
  version,
  body,
  questionnaire,
  shopQuestions,
  copy,
}: {
  version: number;
  body: string;
  questionnaire: MedicalQuestionnaire;
  shopQuestions: readonly ShopQuestion[];
  copy: BlankReleaseCopy;
}) {
  const primary = questionnaire.questions.filter((question) => question.section === "primary");
  return (
    <article data-blank-release className="text-foreground">
      <p className="text-sm font-medium text-muted">
        {copy.version.replace("{version}", String(version))}
      </p>
      <div className="mt-4 wrap-anywhere whitespace-pre-wrap text-base leading-7">{body}</div>

      <section className="mt-10 break-before-page">
        <h2 className={SECTION_TITLE_CLASS}>{copy.medicalHeading}</h2>
        <p className="mt-1 text-sm text-muted">{questionnaire.intro}</p>
        <ol className="mt-3 divide-y divide-border">
          {primary.map((question, index) => (
            <MedicalRow
              key={question.id}
              number={`${index + 1}.`}
              question={question}
              copy={copy}
            />
          ))}
        </ol>
        {(questionnaire.boxes ?? []).map((boxed) => {
          const parentIndex = primary.findIndex(
            (question) => question.boxSection === boxed.section,
          );
          const items = questionnaire.questions.filter(
            (question) => question.section === boxed.section,
          );
          return (
            <div key={boxed.section} className="mt-6 break-inside-avoid">
              <h3 className="text-sm font-semibold">{boxed.title}</h3>
              <p className="text-xs text-muted">
                {copy.followUp.replace("{number}", String(parentIndex + 1))}
              </p>
              <ol className="mt-1 divide-y divide-border">
                {items.map((question, index) => (
                  <MedicalRow
                    key={question.id}
                    number={`${index + 1}.`}
                    question={question}
                    copy={copy}
                  />
                ))}
              </ol>
            </div>
          );
        })}
      </section>

      {shopQuestions.length > 0 ? (
        <section className="mt-10 break-inside-avoid">
          <h2 className={SECTION_TITLE_CLASS}>{copy.shopHeading}</h2>
          <ol className="mt-3 divide-y divide-border">
            {shopQuestions.map((question, index) => (
              <ShopQuestionRow
                key={question.id}
                number={index + 1}
                question={question}
                copy={copy}
              />
            ))}
          </ol>
        </section>
      ) : null}

      <section className="mt-10 break-inside-avoid">
        <h2 className={SECTION_TITLE_CLASS}>{copy.signatureHeading}</h2>
        <Line label={copy.printedName} />
        <Line label={copy.diverSignature} />
        <Line label={copy.date} />
        <p className="mt-8 text-sm text-muted">{copy.guardianNote}</p>
        <Line label={copy.guardianName} />
        <Line label={copy.guardianSignature} />
        <Line label={copy.date} />
      </section>
    </article>
  );
}
