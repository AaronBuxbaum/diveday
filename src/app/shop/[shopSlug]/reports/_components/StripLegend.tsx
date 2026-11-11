import type { StaffTranslator } from "@/i18n/staff-messages";
import { FILL_CLASS } from "./YearStrip";

/** Match each discrete fill to its actual occupancy threshold. */
export function StripLegend({ t }: { t: StaffTranslator }) {
  const labels = [
    t("reports.year.stripQuiet"),
    t("reports.year.stripLow"),
    t("reports.year.stripMedium"),
    t("reports.year.stripFull"),
  ];
  return (
    <ul
      className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted"
      aria-label={t("reports.year.stripLegend")}
    >
      {labels.map((label, index) => (
        <li key={label} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`size-3 rounded-sm ${FILL_CLASS[index as keyof typeof FILL_CLASS]}`}
          />
          {label}
        </li>
      ))}
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="size-3 rounded-sm border border-dashed border-border" />
        {t("reports.year.stripFuture")}
      </li>
    </ul>
  );
}
