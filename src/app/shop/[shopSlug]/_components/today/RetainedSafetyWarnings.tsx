import type { DaySpine } from "@/features/today";
import type { StaffTranslator } from "@/i18n/staff-messages";

export function RetainedSafetyWarnings({ spine, t }: { spine: DaySpine; t: StaffTranslator }) {
  return (
    <>
      {spine.retainedSafetyUnresolved ? (
        <p role="status" className="text-base font-bold text-danger">
          {t("manifest.retainedSafetyWarning")}
        </p>
      ) : null}
      {spine.retainedSafetyAlertNeedsReview ? (
        <p role="status" className="text-base font-bold text-danger">
          {t("manifest.retainedSafetyAlertWarning")}
        </p>
      ) : null}
    </>
  );
}
