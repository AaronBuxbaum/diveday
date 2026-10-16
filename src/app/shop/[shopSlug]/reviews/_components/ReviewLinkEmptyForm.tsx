import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { saveReviewUrlAction } from "../../settings/messages-actions";

/**
 * **The review link, in place** (fifth-loop ideas, item 59). A review arrives
 * when a diver opens the recap after a trip sails, and no setting turns that
 * on. What *is* the shop's to set is where a diver goes next, so the empty
 * ledger offers that one field rather than a paragraph explaining the product.
 * The page renders it for an owner or manager only, as on Settings; the action
 * re-checks and comes back here (`from=reviews`).
 */
export function ReviewLinkEmptyForm({
  reviewUrl,
  t,
}: {
  reviewUrl: string | null;
  t: StaffTranslator;
}) {
  return (
    <form action={saveReviewUrlAction} className="flex w-full max-w-md flex-col gap-2 text-start">
      <input type="hidden" name="from" value="reviews" />
      <label htmlFor="empty-review-url" className="text-sm font-medium">
        {t("reviews.emptyReviewLinkLabel")}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="empty-review-url"
          name="reviewUrl"
          type="url"
          maxLength={500}
          defaultValue={reviewUrl ?? ""}
          placeholder="https://g.page/r/your-shop/review"
          className={`${controlClass} min-w-0 flex-1`}
        />
        <SubmitButton
          pendingLabel={t("reviews.saving")}
          className={buttonClass({ variant: "secondary" })}
        >
          {t("reviews.emptyReviewLinkSave")}
        </SubmitButton>
      </div>
    </form>
  );
}
