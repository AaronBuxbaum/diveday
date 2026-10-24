import type { PrintedMedicalAlerts } from "@/db/medical-alerts";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";

/**
 * **The head of a sheet printed with the medical alerts** (issue #2990): once,
 * above the rows that carry the words. What the words are and are not, who
 * printed them and when in the shop's zone, and what to do with the paper.
 * Print only, and only on the packet "Print with medical alerts" produced.
 */
export function PrintedMedicalAlertsNote({
  printed,
  locale,
  timezone,
  t,
}: {
  printed: PrintedMedicalAlerts;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  return (
    <div className="mt-3 hidden rounded border border-border px-4 py-3 print:block">
      <p className="text-base font-semibold">{t("manifest.medicalAlertsPrintedHeading")}</p>
      <p className="mt-1 text-sm">{t("manifest.medicalAlertNotReviewed")}</p>
      <p className="mt-1 text-sm">
        {t("manifest.medicalAlertsPrintedBy", {
          name: printed.printedBy,
          date: formatDateTimeTz(printed.printedAt, locale, timezone),
        })}
      </p>
      <p className="mt-1 text-sm font-medium">{t("manifest.medicalAlertsPrintedKeep")}</p>
    </div>
  );
}
