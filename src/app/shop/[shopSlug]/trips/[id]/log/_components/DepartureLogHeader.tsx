import { SHELL_TITLE_CLASS } from "@/components/ui/typography";
import type { StaffTranslator } from "@/i18n/staff-messages";
import {
  formatDateTimeTz,
  formatShortDate,
  formatTimeRangeTz,
  formatTimeZoneName,
} from "@/lib/format";
import type { IncidentExportDocument } from "@/lib/incident-export";

export function DepartureLogHeader({
  doc,
  locale,
  t,
}: {
  doc: IncidentExportDocument;
  locale: string;
  t: StaffTranslator;
}) {
  const dateTime = (iso: string) => formatDateTimeTz(new Date(iso), locale, doc.meta.timezone);
  return (
    <header className="border-b border-border pb-6">
      {/* The band above names the document and the shop; the way back and
          Print are the sheet's page's (`SheetDocument`), never on paper. */}
      <h1 className={SHELL_TITLE_CLASS}>{doc.meta.tripTitle}</h1>
      {/* Each dot is glued to what it follows by a no-break space, so a
          wrap falls after one and never starts a line with it. */}
      <p className="mt-1 text-muted">
        {formatShortDate(new Date(doc.meta.tripStartsAt), locale, doc.meta.timezone)}
        {"\u00a0"}·{" "}
        {formatTimeRangeTz(
          new Date(doc.meta.tripStartsAt),
          new Date(doc.meta.tripEndsAt),
          locale,
          doc.meta.timezone,
        )}
        {"\u00a0"}· {doc.meta.shopName}
      </p>
      {/* **One paragraph about the document itself** (visual review
            2026-10-24, B52): what it is, that it states facts and judges none,
            who generated it and when, and the zone every time on it is in. It
            was four, with the disclaimer in bold, before the first fact. */}
      <p className="mt-3 max-w-prose text-sm text-muted">
        {t("incidentExport.preamble", {
          date: dateTime(doc.meta.generatedAt),
          name: doc.meta.generatedByName,
          timezone: formatTimeZoneName(locale, doc.meta.timezone),
        })}
      </p>
    </header>
  );
}
