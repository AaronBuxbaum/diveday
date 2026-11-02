import { StarRatingInput } from "@/components/StarRatingInput";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { FormStatus, textareaClassFor } from "@/components/ui/form";
import type { AfterStateProps } from "@/features/recap-after-state";
import type { DiverMessageKey, DiverTranslator } from "@/i18n/messages";
import { MAX_REVIEW_COMMENT_LENGTH, REVIEW_RATINGS } from "@/lib/reviews";

/**
 * **The one ask.** The review is the after-dive page's single primary in every
 * variant; its submit steps back to secondary only while the carry-it-to-Google
 * door is lit (`stepsBack`), so the page never has two.
 */
export function ReviewAsk({
  t,
  notice,
  ownReview,
  stepsBack,
  action,
}: {
  t: DiverTranslator;
  notice: { tone: "success" | "danger"; key: DiverMessageKey } | undefined;
  ownReview: AfterStateProps["ownReview"];
  stepsBack: boolean;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <SectionCard padding="lg" className="mt-10 print:hidden" title={t("reviews.askHeading")}>
      {notice ? <FormStatus tone={notice.tone}>{t(notice.key)}</FormStatus> : null}
      {ownReview ? (
        <p className="mt-3 text-sm text-muted">
          {t("reviews.yourRating", { rating: ownReview.rating })}
        </p>
      ) : null}
      <form action={action} className="mt-4 flex flex-col gap-3">
        <StarRatingInput
          legend={t("reviews.ratingLegend")}
          optionLabels={Object.fromEntries(
            REVIEW_RATINGS.map((rating) => [rating, t("reviews.ratingOption", { rating })]),
          )}
          defaultValue={ownReview?.rating}
        />
        <label htmlFor="review-comment" className="text-sm font-medium">
          {t("reviews.commentLabel")}
        </label>
        <textarea
          id="review-comment"
          name="comment"
          rows={3}
          maxLength={MAX_REVIEW_COMMENT_LENGTH}
          defaultValue={ownReview?.comment ?? ""}
          placeholder={t("reviews.commentPlaceholder")}
          className={textareaClassFor(3)}
        />
        <div>
          <SubmitButton
            pendingLabel={t("reviews.submitting")}
            className={buttonClass({
              variant: stepsBack ? "secondary" : "primary",
            })}
          >
            {t("reviews.submit")}
          </SubmitButton>
        </div>
      </form>
    </SectionCard>
  );
}
