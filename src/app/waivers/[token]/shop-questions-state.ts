import type { DbExecutor } from "@/db/client";
import { getWaiverTemplateQuestions } from "@/db/waivers";
import type { DiverTranslator } from "@/i18n/messages";
import {
  type DraftShopAnswers,
  restoreDraftShopAnswers,
  type ShopQuestion,
} from "@/lib/waiver-questions";
import { shopQuestionAnchor } from "./ShopQuestionsSection";
import type { WaiverFieldError } from "./waiver-fields";

/** Whether a refused submit named a shop question (`?field=`), rather than a control of DiveDay's own. */
export function isShopQuestionRefusal(field: string | undefined): boolean {
  return field === "shopQuestionRequired" || field === "shopQuestionInvalid";
}

/**
 * **The shop's own questions on the open waiver** (glossary *Shop question*):
 * the ones the version this link was issued under asks, never the shop's
 * current list; the saved draft re-read against them, so a value whose
 * question is gone or no longer fits is dropped rather than pre-filled; and a
 * refusal's question (`?q=`), honoured only when this version asks it, with
 * the anchor that rings it.
 */
export async function shopQuestionsForPage(
  db: DbExecutor,
  record: { shopId: string; templateId: string; draftShopAnswers: DraftShopAnswers | null },
  refusal: {
    field: string | undefined;
    q: string | undefined;
    fieldError: WaiverFieldError | undefined;
  },
  t: DiverTranslator,
): Promise<{
  questions: ShopQuestion[];
  draft: DraftShopAnswers;
  refused: { questionId: string; text: string } | undefined;
  /** The named question's own field error, for the page's refusal ring. */
  refusedFieldError: WaiverFieldError | undefined;
  /** What `WaiverPacing` needs, or nothing when this version asks no questions. */
  pacing: { initialRequiredRemaining: number } | undefined;
}> {
  const questions = await getWaiverTemplateQuestions(db, record.shopId, record.templateId);
  const draft = restoreDraftShopAnswers(questions, record.draftShopAnswers);
  const { field, q, fieldError } = refusal;
  const named =
    isShopQuestionRefusal(field) &&
    fieldError &&
    q &&
    questions.some((question) => question.id === q)
      ? q
      : undefined;
  return {
    questions,
    draft,
    refused: named && fieldError ? { questionId: named, text: t(fieldError.textKey) } : undefined,
    refusedFieldError:
      named && fieldError ? { ...fieldError, anchor: shopQuestionAnchor(named) } : undefined,
    pacing:
      questions.length > 0
        ? {
            initialRequiredRemaining: questions.filter(
              (question) => question.required && draft[question.id] === undefined,
            ).length,
          }
        : undefined,
  };
}
