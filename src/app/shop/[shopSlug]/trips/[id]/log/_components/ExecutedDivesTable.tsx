import { sectionCardClass } from "@/components/ui/card";
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

/**
 * One dive's facts as label and value, in the order both layouts read them:
 * the card list below `md` and the table from `md` up say the same words.
 */
export function executedDiveFields(
  dive: IncidentExecutedDive,
  locale: string,
  timeZone: string,
  t: StaffTranslator,
): { label: string; value: string }[] {
  const notRecorded = t("incidentExport.executedDiveFieldNotRecorded");
  const visibility = dive.observedConditions?.visibility;
  const current = dive.observedConditions?.current;
  return [
    {
      label: t("incidentExport.executedDiveSite"),
      value: dive.actualSiteName ?? t("incidentExport.notOnFile"),
    },
    {
      label: t("incidentExport.executedDiveTimes"),
      value: waterTimes(dive, locale, timeZone, t("incidentExport.executedDiveTimesMissing")),
    },
    {
      label: t("incidentExport.executedDiveDepth"),
      value:
        dive.maxDepthMeters == null
          ? notRecorded
          : `${depthInUnit(dive.maxDepthMeters, "meters")} m / ${depthInUnit(dive.maxDepthMeters, "feet")} ft`,
    },
    {
      label: t("incidentExport.executedDiveConditions"),
      value:
        typeof visibility === "string" || typeof current === "string"
          ? t("incidentExport.executedDiveConditionValue", {
              visibility: typeof visibility === "string" ? visibility : notRecorded,
              current: typeof current === "string" ? current : notRecorded,
            })
          : notRecorded,
    },
    { label: t("incidentExport.executedDiveSurfaceInterval"), value: surfaceIntervalText(dive, t) },
    {
      label: t("incidentExport.executedDiveRecordedBy"),
      value: dive.recordedByName ?? t("incidentExport.notOnFile"),
    },
  ];
}

/**
 * The departure log's executed dive records, one per dive the crew logged.
 *
 * **A labeled card per dive below `md`, the table from `md` up** (visual
 * review 2026-10-24, B04). Seven columns at 390px truncated every header to
 * "ACTU SITE" and broke "Sal Moret" mid-name. The card says each label in full
 * beside its value; paper always takes the table, whatever the sheet's width.
 */
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
  const rows = dives.map((dive) => ({
    dive,
    fields: executedDiveFields(dive, locale, timeZone, t),
  }));
  return (
    <>
      <ul data-dive-cards="" className="mt-3 flex flex-col gap-3 md:hidden print:hidden">
        {rows.map(({ dive, fields }) => (
          <li
            key={dive.diveNumber}
            className={sectionCardClass({ className: "break-inside-avoid" })}
          >
            <h3 className="text-base font-semibold">
              {t("incidentExport.executedDive", { number: dive.diveNumber })}
            </h3>
            <dl className="mt-2 grid gap-2 text-sm">
              {fields.map((field) => (
                <div key={field.label}>
                  <dt className="text-muted">{field.label}</dt>
                  <dd className="font-medium">{field.value}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      <Table shellClassName="mt-3 hidden md:block print:block">
        <THead>
          <Th>{t("incidentExport.executedDiveNumber")}</Th>
          {(rows[0]?.fields ?? []).map((field) => (
            <Th key={field.label}>{field.label}</Th>
          ))}
        </THead>
        <TBody>
          {rows.map(({ dive, fields }) => (
            <tr key={dive.diveNumber}>
              <Th scope="row">{t("incidentExport.executedDive", { number: dive.diveNumber })}</Th>
              {fields.map((field) => (
                <Td key={field.label}>{field.value}</Td>
              ))}
            </tr>
          ))}
        </TBody>
      </Table>
    </>
  );
}
