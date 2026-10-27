import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/ui/card";
import type { IncidentReportLine } from "@/db/incident-reports";
import { INCIDENT_KIND_KEYS, INCIDENT_SEVERITY_KEYS } from "@/i18n/incident-labels";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";

import { formatDateTimeTz, formatEvidenceDateTimeTz, formatShortDate } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import type { SafetyMonth } from "@/lib/safety-report";
import { shopPath } from "@/lib/staff-notices";

const SEVERITY_TONE = { minor: "neutral", moderate: "warning", serious: "danger" } as const;

const ROW = "flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-2";

/**
 * One list behind a figure, only when it has rows (visual review A05): an
 * empty card restated the tile's zero above it. The id is the tile's door.
 */
function ListCard({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div id={id} className="scroll-mt-24">
      <SectionCard title={title}>
        <ul className="divide-y divide-border">{children}</ul>
      </SectionCard>
    </div>
  );
}

/** Where each figure's door lands. */
export const SAFETY_LIST_IDS = {
  incidents: "incident-reports",
  open: "roll-calls-open",
  noCrew: "no-crew-on-record",
  lapsed: "lapsed-crew",
  unrecorded: "crew-nothing-on-file",
} as const;

/**
 * The month's lists: the reports, the counts left open, and, when there are
 * any, the departures that sailed with no crew on record; then the lapsed
 * sailings and the crew who sailed with nothing on file.
 */
export function SafetyLists({
  month,
  incidents,
  credentialKindKeys,
  shopSlug,
  locale,
  timeZone,
  t,
}: {
  month: SafetyMonth;
  incidents: readonly IncidentReportLine[];
  credentialKindKeys: Record<string, StaffMessageKey>;
  shopSlug: string;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  const kindList = cachedListFormat(locale, { type: "conjunction" });
  const tripHref = (tripId: string) => shopPath(shopSlug, "trips", tripId);
  return (
    <>
      <ListCard
        id={SAFETY_LIST_IDS.incidents}
        title={t("incidents.safety.incidentsTitle")}
        count={incidents.length}
      >
        {incidents.map((report) => (
          <li key={report.id}>
            <Link
              href={shopPath(shopSlug, "trips", report.tripId, "incidents", report.id)}
              className={`${ROW} hover:underline`}
            >
              <Badge size="sm" tone={report.status === "filed" ? "neutral" : "warning"}>
                {t(report.status === "filed" ? "incidents.status.filed" : "incidents.status.draft")}
              </Badge>
              <span className="font-medium">{report.tripTitle}</span>
              {/* What kind and how serious (batch 6, item 7), once the report
                  says; a serious one wears the danger the month's reader scans for. */}
              {report.kind ? (
                <span className="text-sm font-medium">{t(INCIDENT_KIND_KEYS[report.kind])}</span>
              ) : null}
              {report.severity ? (
                <Badge size="sm" tone={SEVERITY_TONE[report.severity]}>
                  {t(INCIDENT_SEVERITY_KEYS[report.severity])}
                </Badge>
              ) : null}
              <span className="text-sm text-muted">
                {formatDateTimeTz(report.at, locale, timeZone)}
                {" "}· {t("incidents.trip.writtenBy", { name: report.createdByName })}
              </span>
            </Link>
          </li>
        ))}
      </ListCard>

      <ListCard
        id={SAFETY_LIST_IDS.open}
        title={t("incidents.safety.openTitle")}
        count={month.openRollCalls.length}
      >
        {month.openRollCalls.map((departure) => (
          <li key={departure.tripId}>
            <Link
              href={`${tripHref(departure.tripId)}/manifest`}
              className={`${ROW} hover:underline`}
            >
              <span className="font-medium">{departure.title}</span>
              <span className="text-sm text-muted">
                {formatShortDate(departure.startsAt, locale, timeZone)}
                {" "}·{" "}
                {t(
                  departure.closure === "none"
                    ? "incidents.safety.closureNone"
                    : "incidents.safety.closureOpen",
                )}
              </span>
            </Link>
          </li>
        ))}
      </ListCard>

      {/* Each row opens the departure's crew (fourth review, item 13). */}
      {month.noCrewDepartures.length > 0 ? (
        <ListCard
          id={SAFETY_LIST_IDS.noCrew}
          title={t("incidents.safety.noCrewTitle")}
          count={month.noCrewDepartures.length}
        >
          {month.noCrewDepartures.map((departure) => (
            <li key={departure.tripId}>
              <Link
                href={`${tripHref(departure.tripId)}?view=details#crew`}
                className={`${ROW} hover:underline`}
              >
                <span className="font-medium">{departure.title}</span>
                <span className="text-sm text-muted">
                  {formatShortDate(departure.startsAt, locale, timeZone)}
                </span>
              </Link>
            </li>
          ))}
        </ListCard>
      ) : null}

      <ListCard
        id={SAFETY_LIST_IDS.lapsed}
        title={t("incidents.safety.lapsedTitle")}
        count={month.lapsedSailings.length}
      >
        {month.lapsedSailings.map((sailing) => (
          <li key={`${sailing.tripId}:${sailing.personId}`}>
            <Link href={tripHref(sailing.tripId)} className={`${ROW} hover:underline`}>
              <span className="font-medium">{sailing.name}</span>
              <span className="text-sm text-muted">
                {sailing.title}
                {" "}· {formatShortDate(sailing.startsAt, locale, timeZone)}
                {" "}·{" "}
                {kindList.format(
                  sailing.kinds.map((kind) =>
                    t(credentialKindKeys[kind] ?? "staffing.credentials.kinds.other"),
                  ),
                )}
                {sailing.observationStartedAt && sailing.observationCapturedAt ? (
                  <>
                    {" "}·{" "}
                    {t("incidents.safety.crewObservedBetween", {
                      start: formatEvidenceDateTimeTz(
                        sailing.observationStartedAt,
                        locale,
                        timeZone,
                      ),
                      end: formatEvidenceDateTimeTz(
                        sailing.observationCapturedAt,
                        locale,
                        timeZone,
                      ),
                    })}
                  </>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ListCard>

      {month.unrecordedCrew.length > 0 ? (
        <ListCard
          id={SAFETY_LIST_IDS.unrecorded}
          title={t("incidents.safety.unrecordedTitle")}
          count={month.unrecordedCrew.length}
        >
          {month.unrecordedCrew.map((person) => (
            <li key={person.personId}>
              <Link
                href={shopPath(shopSlug, "settings", "team")}
                className={`${ROW} hover:underline`}
              >
                <span className="font-medium">{person.name}</span>
                <span className="text-sm text-muted">
                  {t("incidents.safety.unrecordedSailings", { count: person.sailings })}
                </span>
              </Link>
            </li>
          ))}
        </ListCard>
      ) : null}
    </>
  );
}
