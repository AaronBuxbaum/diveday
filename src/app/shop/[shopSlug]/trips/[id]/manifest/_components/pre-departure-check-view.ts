import type { latestPreDepartureChecksForTrip, listChecklistItems } from "@/db/pre-departure-check";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";

/**
 * The boat check as `PreDepartureCheckList` draws it: each item with who
 * checked it and when, the sentence paper keeps, and the summary line's
 * count.
 */
export function preDepartureCheckView({
  checklistItems,
  checklistChecks,
  locale,
  timeZone,
  t,
}: {
  checklistItems: Awaited<ReturnType<typeof listChecklistItems>>;
  checklistChecks: Awaited<ReturnType<typeof latestPreDepartureChecksForTrip>>;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  const checklistListItems = checklistItems.map((item) => {
    const check = checklistChecks.get(item.id);
    const checkedByLine = check
      ? t("trips.preDepartureCheck.checkedBy", {
          name: check.recordedByName,
          date: formatDateTimeTz(check.occurredAt, locale, timeZone),
        })
      : undefined;
    return {
      id: item.id,
      label: item.label,
      checkedByLine,
      // The trip packet's print stylesheet hides the interactive control
      // this item otherwise renders as (a <button>) — this whole sentence is
      // what survives on the printed sheet, composed here rather than in the
      // client component so word order and the separator stay a locale
      // choice, not a JSX literal's.
      printLine: checkedByLine
        ? t("trips.preDepartureCheck.printLineChecked", {
            label: item.label,
            status: checkedByLine,
          })
        : t("trips.preDepartureCheck.printLineNotChecked", { label: item.label }),
    };
  });
  return {
    items: checklistListItems,
    copy: {
      heading: t("trips.preDepartureCheck.heading"),
      summary: t("trips.preDepartureCheck.summary", {
        checked: checklistListItems.filter((item) => item.checkedByLine !== undefined).length,
        total: checklistListItems.length,
      }),
      errorRefusal: t("trips.preDepartureCheck.errorRefusal"),
      checkedLabel: t("trips.preDepartureCheck.checkedLabel"),
      uncheckedLabel: t("trips.preDepartureCheck.uncheckedLabel"),
    },
  };
}
