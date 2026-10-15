import { Table, TBody, Td, THead, Th } from "@/components/ui/table";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { depthInUnit } from "@/lib/depth-units";
import { formatDateTimeTz, formatShortDate, formatTimeRangeTz } from "@/lib/format";
import type { IncidentExecutedDive } from "@/lib/incident-export";

/**
 * **A dive's water times as one fact** (fourth review, item 17). Printed as
 * two full date-times, a same-day dive wrapped onto four lines on paper
 * ("Oct 14, / 5:50 AM EDT – / Oct 14, / 6:30 AM EDT"). A dive in and out on
 * one shop-local day says the day once and the times as a range; one that
 * crosses midnight keeps both dates, because that is the fact. A missing end
 * says so in words.
 */
export function waterTimes(
  dive: Pick<IncidentExecutedDive, "enteredAt" | "exitedAt">,
  locale: string,
  timeZone: string,
  missing: string,
): string {
  const entered = dive.enteredAt ? new Date(dive.enteredAt) : null;
  const exited = dive.exitedAt ? new Date(dive.exitedAt) : null;
  if (
    entered &&
    exited &&
    calendarDateInTimezone(entered, timeZone) === calendarDateInTimezone(exited, timeZone)
  ) {
    return `${formatShortDate(entered, locale, timeZone)} · ${formatTimeRangeTz(entered, exited, locale, timeZone)}`;
  }
  const at = (date: Date | null) => (date ? formatDateTimeTz(date, locale, timeZone) : missing);
  return `${at(entered)} – ${at(exited)}`;
}

/**
 * The surface interval cell. Dive 1 has none to record, and "Not recorded"
 * there read as a gap on the document an insurer reads (fourth review, item
 * 17); it says "First dive". A later dive with no interval worked out still
 * says it was not recorded.
 */
export function surfaceIntervalText(
  dive: Pick<IncidentExecutedDive, "diveNumber" | "surfaceIntervalMinutes">,
  t: StaffTranslator,
): string {
  if (dive.diveNumber === 1) return t("incidentExport.executedDiveFirstDive");
  return dive.surfaceIntervalMinutes == null
    ? t("incidentExport.executedDiveFieldNotRecorded")
    : t("incidentExport.executedDiveSurfaceIntervalValue", {
        minutes: dive.surfaceIntervalMinutes,
      });
}

/** The departure log's executed dive records, one row per dive the crew logged. */
export function ExecutedDivesTable({
  dives,
  locale,
  timeZone,
  t,
}: {
  dives: readonly IncidentExecutedDive[];
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  const notRecorded = t("incidentExport.executedDiveFieldNotRecorded");
  return (
    <Table className="mt-3">
      <THead>
        <Th>{t("incidentExport.executedDiveNumber")}</Th>
        <Th>{t("incidentExport.executedDiveSite")}</Th>
        <Th>{t("incidentExport.executedDiveTimes")}</Th>
        <Th>{t("incidentExport.executedDiveDepth")}</Th>
        <Th>{t("incidentExport.executedDiveConditions")}</Th>
        <Th>{t("incidentExport.executedDiveSurfaceInterval")}</Th>
        <Th>{t("incidentExport.executedDiveRecordedBy")}</Th>
      </THead>
      <TBody>
        {dives.map((dive) => {
          const visibility = dive.observedConditions?.visibility;
          const current = dive.observedConditions?.current;
          return (
            <tr key={dive.diveNumber}>
              <Th scope="row">{t("incidentExport.executedDive", { number: dive.diveNumber })}</Th>
              <Td>{dive.actualSiteName ?? t("incidentExport.notOnFile")}</Td>
              <Td>
                {waterTimes(dive, locale, timeZone, t("incidentExport.executedDiveTimesMissing"))}
              </Td>
              <Td>
                {dive.maxDepthMeters == null
                  ? notRecorded
                  : `${depthInUnit(dive.maxDepthMeters, "meters")} m / ${depthInUnit(dive.maxDepthMeters, "feet")} ft`}
              </Td>
              <Td>
                {typeof visibility === "string" || typeof current === "string"
                  ? t("incidentExport.executedDiveConditionValue", {
                      visibility: typeof visibility === "string" ? visibility : notRecorded,
                      current: typeof current === "string" ? current : notRecorded,
                    })
                  : notRecorded}
              </Td>
              <Td>{surfaceIntervalText(dive, t)}</Td>
              <Td>{dive.recordedByName ?? t("incidentExport.notOnFile")}</Td>
            </tr>
          );
        })}
      </TBody>
    </Table>
  );
}
