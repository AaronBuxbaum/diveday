import type { MedicalAnswers } from "@/db/schema";
import { type MedicalQuestionnaire, medicalProgress, medicalQuestionField } from "@/lib/medical";

/**
 * **Where the saved medical draft already stands, so the first paint is
 * honest.** Moved out of the waiver page unchanged.
 *
 * Only draft answers captured against this same questionnaire pre-fill.
 * `primaryQuestionCount` is the fixed list of questions the diver is handed;
 * the follow-ups their own answers open are deliberately not in it (see
 * `QuestionnaireProgress`).
 *
 * `WaiverPacing`'s live count is a delegated listener and cannot see an answer
 * given before it mounted; without `draftAnsweredFields` and
 * `draftFollowUpsRemaining` the HTML ships "0 of 3 done" over radios the
 * server has just rendered checked. The page knows both, so it hands them over
 * rather than leaving the client to discover them a bundle later, or, with
 * JavaScript off, never. `remaining - primaryRemaining` is exactly the blanks
 * inside a Box the diver's own yes opened: `medicalProgress` counts
 * *applicable* questions, so a Box nothing opened is not in either figure.
 */
export function medicalDraftState(
  questionnaire: MedicalQuestionnaire,
  draft: MedicalAnswers | null,
): {
  draftResponses: MedicalAnswers["responses"] | undefined;
  primaryQuestionCount: number;
  draftAnsweredFields: string[];
  draftFollowUpsRemaining: number;
} {
  const draftResponses =
    draft &&
    draft.questionnaireId === questionnaire.id &&
    draft.questionnaireVersion === questionnaire.version
      ? draft.responses
      : undefined;
  const primaryQuestionCount = questionnaire.questions.filter(
    (question) => question.section === "primary",
  ).length;
  const draftAnswers: Readonly<Record<string, boolean | undefined>> = draftResponses ?? {};
  const draftProgress = medicalProgress(questionnaire, draftAnswers);
  const draftAnsweredFields = questionnaire.questions
    .filter(
      (question) =>
        question.section === "primary" && typeof draftAnswers[question.id] === "boolean",
    )
    .map((question) => medicalQuestionField(question.id));
  return {
    draftResponses,
    primaryQuestionCount,
    draftAnsweredFields,
    draftFollowUpsRemaining: draftProgress.remaining - draftProgress.primaryRemaining,
  };
}
