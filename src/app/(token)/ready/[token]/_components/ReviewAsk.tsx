import { StarRatingInput } from "@/components/StarRatingInput";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, FormStatus, legendClass, textareaClassFor } from "@/components/ui/form";
import type { AfterStateProps } from "@/features/recap-after-state";
import type { DiverMessageKey, DiverTranslator } from "@/i18n/messages";
import { MAX_CREW_THANKS_LENGTH, MAX_REVIEW_COMMENT_LENGTH, REVIEW_RATINGS } from "@/lib/reviews";

/**
 * **The one ask.** The review is the after-dive page's single primary in every
 * variant; its submit steps back to secondary only while the carry-it-to-Google
 * door is lit (`stepsBack`), so the page never has two.
 */
export function ReviewAsk({
  t,
  notice,
  ownReview,
  crewChoices,
  stepsBack,
  action,
}: {
  t: DiverTranslator;
  notice: { tone: "success" | "danger"; key: DiverMessageKey } | undefined;
  ownReview: AfterStateProps["ownReview"];
  crewChoices: AfterStateProps["crewChoices"];
  stepsBack: boolean;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <SectionCard padding="lg" className="mt-10" title={t("reviews.askHeading")}>
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
          aria-describedby="review-usage"
          className={textareaClassFor(3)}
        />
        <p id="review-usage" className="text-xs text-muted">
          {t("reviews.usageHint")}
        </p>
        {/* **Thank someone by name** (loop 5, row 6): one optional line for one
            of the crew, seen only by them and the shop, never published. */}
        {crewChoices.length > 0 ? (
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className={`${legendClass} text-sm font-medium`}>
              {t("reviews.thanksLegend")}
            </legend>
            <select
              name="crewThanksChoice"
              aria-label={t("reviews.thanksWho")}
              defaultValue={ownReview?.crewThanksChoice ?? ""}
              className={controlClass}
            >
              <option value="">{t("reviews.thanksNobody")}</option>
              {crewChoices.map((crew) => (
                <option key={crew.choice} value={crew.choice}>
                  {crew.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              name="crewThanks"
              aria-label={t("reviews.thanksLine")}
              maxLength={MAX_CREW_THANKS_LENGTH}
              defaultValue={ownReview?.crewThanks ?? ""}
              placeholder={t("reviews.thanksPlaceholder")}
              className={controlClass}
            />
            <p className="text-xs text-muted">{t("reviews.thanksHint")}</p>
          </fieldset>
        ) : null}
        <div>
          <SubmitButton
            pendingLabel={t("words.busy.sending")}
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
