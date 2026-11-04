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
  paper,
  children,
}: {
  id: string;
  title: string;
  count: number;
  paper: boolean;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  // On the sheet a list is a heading and its rows: no card, no link.
  if (paper)
    return (
      <section id={id} className="break-inside-avoid">
        <h2 className="mb-1 text-sm font-bold">{title}</h2>
        <ul className="divide-y divide-border">{children}</ul>
      </section>
    );
  return (
    <div id={id} className="scroll-mt-24">
      <SectionCard title={title}>
        <ul className="divide-y divide-border">{children}</ul>
      </SectionCard>
    </div>
  );
}

/** A row: a door to its record on the screen, plain words on the sheet. */
function Row({
  href,
  paper,
  children,
}: {
  href: string;
  paper: boolean;
  children: React.ReactNode;
}) {
  if (paper) return <div className={ROW}>{children}</div>;
  return (
    <Link href={href} className={`${ROW} hover:underline`}>
      {children}
    </Link>
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
  paper = false,
}: {
  month: SafetyMonth;
  incidents: readonly IncidentReportLine[];
  credentialKindKeys: Record<string, StaffMessageKey>;
  shopSlug: string;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
  /** The sheet's rows: no links, no cards. */
  paper?: boolean;
}) {
  const kindList = cachedListFormat(locale, { type: "conjunction" });
  const tripHref = (tripId: string) => shopPath(shopSlug, "trips", tripId);
  return (
    <>
      <ListCard
        paper={paper}
        id={SAFETY_LIST_IDS.incidents}
        title={t("incidents.safety.incidentsTitle")}
        count={incidents.length}
      >
        {incidents.map((report) => (
          <li key={report.id}>
            <Row
              href={shopPath(shopSlug, "trips", report.tripId, "incidents", report.id)}
              paper={paper}
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
            </Row>
          </li>
        ))}
      </ListCard>

      <ListCard
        paper={paper}
        id={SAFETY_LIST_IDS.open}
        title={t("incidents.safety.openTitle")}
        count={month.openRollCalls.length}
      >
        {month.openRollCalls.map((departure) => (
          <li key={departure.tripId}>
            <Row href={`${tripHref(departure.tripId)}/manifest`} paper={paper}>
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
            </Row>
          </li>
        ))}
      </ListCard>

      {/* Each row opens the departure's crew (fourth review, item 13). */}
      <ListCard
        paper={paper}
        id={SAFETY_LIST_IDS.noCrew}
        title={t("incidents.safety.noCrewTitle")}
        count={month.noCrewDepartures.length}
      >
        {month.noCrewDepartures.map((departure) => (
          <li key={departure.tripId}>
            <Row href={`${tripHref(departure.tripId)}?view=details#crew`} paper={paper}>
              <span className="font-medium">{departure.title}</span>
              <span className="text-sm text-muted">
                {formatShortDate(departure.startsAt, locale, timeZone)}
              </span>
            </Row>
          </li>
        ))}
      </ListCard>

      <ListCard
        paper={paper}
        id={SAFETY_LIST_IDS.lapsed}
        title={t("incidents.safety.lapsedTitle")}
        count={month.lapsedSailings.length}
      >
        {month.lapsedSailings.map((sailing) => (
          <li key={`${sailing.tripId}:${sailing.personId}`}>
            <Row href={tripHref(sailing.tripId)} paper={paper}>
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
            </Row>
          </li>
        ))}
      </ListCard>

      <ListCard
        paper={paper}
        id={SAFETY_LIST_IDS.unrecorded}
        title={t("incidents.safety.unrecordedTitle")}
        count={month.unrecordedCrew.length}
      >
        {month.unrecordedCrew.map((person) => (
          <li key={person.personId}>
            <Row href={shopPath(shopSlug, "settings", "team")} paper={paper}>
              <span className="font-medium">{person.name}</span>
              <span className="text-sm text-muted">
                {t("incidents.safety.unrecordedSailings", { count: person.sailings })}
              </span>
            </Row>
          </li>
        ))}
      </ListCard>
    </>
  );
}
