import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/ui/card";
import type { IncidentReportLine } from "@/db/incident-reports";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz, formatShortDate } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import type { SafetyMonth } from "@/lib/safety-report";
import { shopPath } from "@/lib/staff-notices";

const ROW = "flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-2";

function ListCard({
  title,
  empty,
  count,
  children,
}: {
  title: string;
  empty: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <SectionCard title={title}>
      {count === 0 ? (
        <p className="text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-border">{children}</ul>
      )}
    </SectionCard>
  );
}

/** The month's three lists: the reports, the counts left open, the lapsed sailings. */
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
        title={t("incidents.safety.incidentsTitle")}
        empty={t("incidents.safety.incidentsEmpty")}
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
              <span className="text-sm text-muted">
                {formatDateTimeTz(report.at, locale, timeZone)}
                {" "}· {t("incidents.trip.writtenBy", { name: report.createdByName })}
              </span>
            </Link>
          </li>
        ))}
      </ListCard>

      <ListCard
        title={t("incidents.safety.openTitle")}
        empty={t("incidents.safety.openEmpty")}
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

      <ListCard
        title={t("incidents.safety.lapsedTitle")}
        empty={t("incidents.safety.lapsedEmpty")}
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
              </span>
            </Link>
          </li>
        ))}
      </ListCard>
    </>
  );
}
