import { staffPassengerCount } from "@/i18n/participant-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { IncidentExportDocument } from "@/lib/incident-export";

/**
 * The incident record's count tiles, in reading order. Counts of records, not
 * judgments. The first is everyone on the manifest, with who was diving when
 * anybody aboard was not (ADR 20261007-participant-types).
 */
export function incidentSummaryRows(
  t: StaffTranslator,
  summary: IncidentExportDocument["departureSummary"],
): [string, number | string][] {
  return [
    [t("incidentExport.summaryDivers"), staffPassengerCount(t, summary)],
    [t("incidentExport.summaryBoarded"), summary.boarded],
    [t("incidentExport.summaryNotBoarded"), summary.notBoarded],
    [t("incidentExport.summaryAwaiting"), summary.awaiting],
    [t("incidentExport.summaryCrewAssigned"), summary.crewAssigned],
  ];
}
