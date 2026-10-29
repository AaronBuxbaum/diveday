import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { UndoToast } from "@/components/UndoToast";
import { buttonClass } from "@/components/ui/button";
import { staffTranslator } from "@/i18n/staff-messages";
import { type FormNotice, noticeRole } from "@/lib/staff-notices";

export { resolveTripNotice, type TripNoticeInput } from "./trip-notice-resolution";

/**
 * The page-level banner, now only for what has no form to sit beside: a
 * permission refusal and any roster removal that still has an undo action.
 */
export function TripNoticeBanner({
  notice,
  locale,
  undoBookingId,
  undoAction,
}: {
  notice?: FormNotice;
  locale: string;
  undoBookingId?: string;
  // Only the roster's reversible removals carry an undo; Overview's config
  // notices render the same banner without one.
  undoAction?: (formData: FormData) => void;
}) {
  if (!notice) return null;
  const t = staffTranslator(locale);
  if (notice.tone === "success" && undoBookingId && undoAction) {
    return (
      <UndoToast
        message={notice.text}
        action={undoAction}
        fields={{ bookingId: undoBookingId }}
        pendingLabel={t("trips.notices.undoing")}
        undoLabel={t("trips.notices.undo")}
        dismissLabel={t("shared.undoToast.dismiss")}
      />
    );
  }

  return (
    <div className="mt-6">
      <ShopNotice tone={notice.tone} role={noticeRole(notice.tone)}>
        <div className="flex items-center justify-between gap-3">
          <span>{notice.text}</span>
          {undoBookingId && undoAction ? (
            <form action={undoAction}>
              <input type="hidden" name="bookingId" value={undoBookingId} />
              <SubmitButton
                pendingLabel={t("trips.notices.undoing")}
                className={buttonClass({
                  variant: "link",
                  size: "sm",
                  busy: true,
                  className: "underline-offset-2",
                })}
              >
                {t("trips.notices.undo")}
              </SubmitButton>
            </form>
          ) : null}
        </div>
      </ShopNotice>
    </div>
  );
}
