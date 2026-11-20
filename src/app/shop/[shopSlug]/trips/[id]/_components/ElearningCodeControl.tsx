import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * **A student's eLearning code, on the course session's roster** (ADR 20261120-course-elearning-codes):
 * the code they hold with a way to take it back, or one tap to hand them the oldest in stock with
 * how many are left. The shop's own ledger: it says nothing about whether the theory is done.
 */
export function ElearningCodeControl({
  action,
  bookingId,
  elearningCode,
  t,
}: {
  action: (formData: FormData) => void;
  bookingId: string;
  elearningCode: { code: string | null; left: number };
  t: StaffTranslator;
}) {
  const { code, left } = elearningCode;
  return (
    <form action={action} className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="give" value={code ? "false" : "true"} />
      {code ? (
        <>
          <span className="text-sm">
            <span className="text-muted">{t("trips.roster.elearningCode")}</span>{" "}
            <code className="select-all font-mono font-semibold">{code}</code>
          </span>
          <SubmitButton
            pendingLabel={t("words.busy.saving")}
            className={buttonClass({ variant: "link", size: "sm", flush: true })}
          >
            {t("trips.roster.elearningCodeTakeBack")}
          </SubmitButton>
        </>
      ) : left > 0 ? (
        <>
          <SubmitButton
            pendingLabel={t("words.busy.saving")}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {t("trips.roster.elearningCodeGive")}
          </SubmitButton>
          <span className="text-sm text-muted">
            {t("trips.roster.elearningCodesLeft", { count: left })}
          </span>
        </>
      ) : (
        <span className="text-sm text-muted">
          {t("trips.roster.elearningCodesLeft", { count: 0 })}
        </span>
      )}
    </form>
  );
}
