import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * "This diver signed on paper" — the escape hatch for a signature the app
 * never sees, on every staff surface that can be held up by a missing waiver.
 *
 * The medical attestation is a required checkbox naming what the staffer is
 * asserting, not a buried confirm: `recordInPersonWaiver` refuses without it,
 * and a flagged medical answer must go through the diver-facing link, which
 * captures the questionnaire and routes it to review. The result is the same
 * immutable completed record a self-service signature produces, marked
 * `in_person_attested` and stamped with the staff member who attested.
 *
 * One component rather than a per-surface copy: the roster grew this control
 * first, and the check-in counter — where a diver is standing in front of you
 * holding the paper — had no way to record it at all.
 */
export function PaperWaiverControl({
  action,
  bookingId,
  t,
  className = "mt-2",
}: {
  // i18n-exempt: type annotation, not copy.
  action: (formData: FormData) => void | Promise<void>;
  bookingId: string;
  t: StaffTranslator;
  className?: string;
}) {
  return (
    <details className={className}>
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-primary hover:underline">
        {t("shared.paperWaiver.markSignedOnPaper")}
      </summary>
      <form
        action={action}
        className="mt-2 max-w-md rounded-lg border border-border bg-surface-sunken/50 p-3"
      >
        <input type="hidden" name="bookingId" value={bookingId} />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="medicalAttested" required className="mt-1 size-4 shrink-0" />
          <span>{t("shared.paperWaiver.medicalAttestationLabel")}</span>
        </label>
        <SubmitButton
          pendingLabel={t("shared.paperWaiver.recording")}
          className={buttonClass({ variant: "secondary", size: "sm", className: "mt-3" })}
        >
          {t("shared.paperWaiver.recordPaperSignature")}
        </SubmitButton>
      </form>
    </details>
  );
}
