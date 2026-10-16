import Link from "next/link";
import { sectionCardClass } from "@/components/ui/card";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { INCIDENT_KIND_KEYS, INCIDENT_SEVERITY_KEYS } from "@/i18n/incident-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz, formatShortDate } from "@/lib/format";
import type { IncidentLogReport } from "@/lib/incident-export";

/**
 * **The departure's incident reports, at the end of its log** (safety sheet
 * 2026-10-15, item 5). A list and a link, never a report's contents: kind,
 * severity, when it was filed and by whom, and how many later notes it has.
 * An unfiled draft says so and who started it, because a log handed to an
 * insurer that is silent about a report the shop holds reads as no report.
 * Only an owner reaches this page, and an owner may read every report, so the
 * list widens nobody's view.
 */
export function IncidentReportsSection({
  reports,
  reportHref,
  t,
  locale,
  timeZone,
}: {
  reports: readonly IncidentLogReport[];
  reportHref: (reportId: string) => string;
  t: StaffTranslator;
  locale: string;
  timeZone: string;
}) {
  return (
    <section aria-labelledby="incident-reports-heading">
      <h2 id="incident-reports-heading" className={SECTION_TITLE_CLASS}>
        {t("incidentExport.reportsHeading")}
      </h2>
      <p className="mt-1 max-w-prose text-sm text-muted">
        {t("incidentExport.reportsDescription")}
      </p>
      {reports.length === 0 ? (
        <p className="mt-3 text-sm font-semibold">{t("incidentExport.reportsEmpty")}</p>
      ) : (
        <ol
          className={sectionCardClass({
            padding: "none",
            className: "mt-3 divide-y divide-border",
          })}
        >
          {reports.map((report) => (
            <li
              key={report.reportId}
              className="break-inside-avoid flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm sm:px-5"
            >
              <Link href={reportHref(report.reportId)} className="font-semibold hover:underline">
                {[
                  report.kind ? t(INCIDENT_KIND_KEYS[report.kind]) : null,
                  report.severity ? t(INCIDENT_SEVERITY_KEYS[report.severity]) : null,
                ]
                  .filter(Boolean)
                  .join(" — ") || t("incidentExport.reportUnsorted")}
              </Link>
              <span className="text-muted">
                {report.status === "filed" && report.filedAt
                  ? t("incidentExport.reportFiled", {
                      date: formatDateTimeTz(new Date(report.filedAt), locale, timeZone),
                      name: report.filedByName ?? "",
                    })
                  : t("incidentExport.reportDraft", {
                      name: report.createdByName,
                      date: formatShortDate(new Date(report.createdAt), locale, timeZone),
                    })}
              </span>
              {report.status === "filed" ? (
                <span className="text-muted">
                  {t("incidentExport.reportAddenda", { count: report.addendaCount })}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
