"use client";

import { type ReactNode, useActionState, useState } from "react";
import { Field, FieldGrid, FormStatus, textareaClassFor } from "@/components/ui/form";
import type { NoticeTone } from "@/lib/staff-notices";
import { normalizeShopText, type ShopQuestion, shopQuestionsEqual } from "@/lib/waiver-questions";
import { RELEASE_FORM_IDLE, type ReleaseFormState } from "../release-form-state";
import { PublishRelease, type PublishReleaseCopy } from "./PublishRelease";
import { type ShopQuestionsCopy, ShopQuestionsEditor } from "./ShopQuestionsEditor";

/** The line beside Publish for each refusal, composed on the server. */
export type ReleaseFormRefusalCopy = {
  body: string;
  materiality: string;
  questions: string;
  /** "That didn't publish. Question {number} needs a fix.", unfilled. */
  questionNumbered: string;
};

/**
 * **The release editor's form**: the text, the shop's questions and the one
 * Publish, bound to `saveWaiverAction` through `useActionState`.
 *
 * A refused publish answers here rather than navigating, and hands back what
 * was typed (`../release-form-state.ts`): the text, every question and the
 * materiality choice stand up again, the refused question shows its problem
 * under its control, and the line beside Publish says what to fix (dive-domain
 * review 2, S2). The editor checks the same rules as the staffer types, so
 * the browser's own gate stops most of these before a request is made.
 *
 * It also knows whether only the questions changed, which is what the
 * publish choice's wording turns on (review 2, S1): the text compared after
 * the same normalisation a save uses, and the list with `shopQuestionsEqual`.
 * Materiality is still the staffer's explicit choice.
 */
export function ReleaseForm({
  action,
  fieldLabel,
  placeholder,
  initialBody,
  published,
  pdfDraft,
  standardQuestionnaire,
  questionsCopy,
  healthWords,
  publishCopy,
  standingSignatures,
  refusalCopy,
  status,
}: {
  action: (state: ReleaseFormState, formData: FormData) => Promise<ReleaseFormState>;
  fieldLabel: string;
  placeholder: string;
  /** What the textarea opens with: the published text, or the sample release. */
  initialBody: string;
  /** The version divers sign now, if any: what "changed" is measured against. */
  published: { body: string; questions: readonly ShopQuestion[] } | null;
  pdfDraft: ReactNode;
  standardQuestionnaire: ReactNode;
  questionsCopy: ShopQuestionsCopy;
  healthWords: readonly string[];
  publishCopy: PublishReleaseCopy;
  standingSignatures: boolean;
  refusalCopy: ReleaseFormRefusalCopy;
  /** A publish that landed and came back with its `?notice=`, already worded. */
  status: { tone: NoticeTone; content: ReactNode } | null;
}) {
  const [state, formAction] = useActionState(action, RELEASE_FORM_IDLE);
  const refused = state.status === "refused" ? state : null;
  // Remounted on each refusal, so every uncontrolled control and the
  // editor's own rows start from what was typed, not from the published copy.
  const generation = refused ? JSON.stringify(refused) : "published";
  return (
    <form action={formAction} className="flex flex-col gap-5">
      <ReleaseFormFields
        key={generation}
        fieldLabel={fieldLabel}
        placeholder={placeholder}
        body={refused ? refused.typed.body : initialBody}
        questions={refused?.typed.questions ?? published?.questions ?? []}
        refusedNumber={refused?.questionNumber}
        material={refused?.typed.material ?? null}
        published={published}
        pdfDraft={pdfDraft}
        standardQuestionnaire={standardQuestionnaire}
        questionsCopy={questionsCopy}
        healthWords={healthWords}
        publishCopy={publishCopy}
        standingSignatures={standingSignatures}
      />
      {/* Beside the form, never a banner at the top of the page: the release
          is a fourteen-row textarea, so the top of this page is a screen and
          a half away from the control that was pressed. */}
      {refused ? (
        <FormStatus tone="danger">
          {refused.refusal === "body"
            ? refusalCopy.body
            : refused.refusal === "materiality"
              ? refusalCopy.materiality
              : refused.questionNumber !== undefined
                ? refusalCopy.questionNumbered.replace("{number}", String(refused.questionNumber))
                : refusalCopy.questions}
        </FormStatus>
      ) : (
        <FormStatus tone={status?.tone ?? "success"}>{status?.content}</FormStatus>
      )}
    </form>
  );
}

function ReleaseFormFields({
  fieldLabel,
  placeholder,
  body,
  questions,
  refusedNumber,
  material,
  published,
  pdfDraft,
  standardQuestionnaire,
  questionsCopy,
  healthWords,
  publishCopy,
  standingSignatures,
}: {
  fieldLabel: string;
  placeholder: string;
  body: string;
  questions: readonly ShopQuestion[];
  refusedNumber: number | undefined;
  material: "material" | "non-material" | null;
  published: { body: string; questions: readonly ShopQuestion[] } | null;
  pdfDraft: ReactNode;
  standardQuestionnaire: ReactNode;
  questionsCopy: ShopQuestionsCopy;
  healthWords: readonly string[];
  publishCopy: PublishReleaseCopy;
  standingSignatures: boolean;
}) {
  const [bodyNow, setBodyNow] = useState(body);
  const [questionsNow, setQuestionsNow] = useState<readonly ShopQuestion[]>(questions);
  const questionsOnly =
    published !== null &&
    normalizeShopText(bodyNow) === normalizeShopText(published.body) &&
    !shopQuestionsEqual(questionsNow, published.questions);
  return (
    <>
      <FieldGrid columns={1} className="gap-y-5">
        <Field label={fieldLabel}>
          <textarea
            id="release-body"
            name="body"
            required
            rows={14}
            maxLength={12_000}
            defaultValue={body}
            onChange={(event) => setBodyNow(event.target.value)}
            placeholder={placeholder}
            className={textareaClassFor(14)}
          />
        </Field>
      </FieldGrid>
      {pdfDraft}
      {standardQuestionnaire}
      <ShopQuestionsEditor
        initialQuestions={questions}
        healthWords={healthWords}
        copy={questionsCopy}
        refusedNumber={refusedNumber}
        onChange={setQuestionsNow}
      />
      <PublishRelease
        copy={publishCopy}
        standingSignatures={standingSignatures}
        questionsOnly={questionsOnly}
        initialChoice={material}
      />
    </>
  );
}
