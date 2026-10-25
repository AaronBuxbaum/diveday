import type { PrintedMedicalAlerts } from "@/db/medical-alerts";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import type { TripManifest } from "@/lib/manifests";

/**
 * **The head of a sheet printed with the medical alerts** (issue #2990): once,
 * above the rows that carry the words. What the words are and are not; which
 * rows carry one, by the number the roster prints and the name, so the crew
 * finds row 06 without paging a full boat (domain reviews 1 N3, 2 S4); who
 * printed them and when in the shop's zone, and that the sheet is a snapshot
 * from then (domain review 1, S4); and what to do with the paper. Print only,
 * and only on the packet "Print with medical alerts" produced.
 */
export function PrintedMedicalAlertsNote({
  printed,
  divers,
  locale,
  timezone,
  t,
}: {
  printed: PrintedMedicalAlerts;
  /** The roster in printed order, held seats already withheld. */
  divers: readonly TripManifest["divers"][number][];
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  const onSheet = divers.flatMap((diver, index) =>
    printed.texts.has(diver.bookingId) && !diver.identityWithheld
      ? [`${String(index + 1).padStart(2, "0")} ${diver.fullName}`]
      : [],
  );
  return (
    <div data-print-only className="mt-3 hidden rounded border border-border px-4 py-3 print:block">
      <p className="text-base font-semibold">{t("manifest.medicalAlertsPrintedHeading")}</p>
      <p className="mt-1 text-sm">{t("manifest.medicalAlertNotReviewed")}</p>
      {onSheet.length > 0 ? (
        <p className="mt-1 text-sm font-medium">
          {t("manifest.medicalAlertsPrintedOnSheet", { divers: onSheet.join(", ") })}
        </p>
      ) : null}
      <p className="mt-1 text-sm">
        {t("manifest.medicalAlertsPrintedBy", {
          name: printed.printedBy,
          date: formatDateTimeTz(printed.printedAt, locale, timezone),
        })}{" "}
        {t("manifest.medicalAlertsPrintedSnapshot")}
      </p>
      <p className="mt-1 text-sm font-medium">{t("manifest.medicalAlertsPrintedKeep")}</p>
    </div>
  );
}
