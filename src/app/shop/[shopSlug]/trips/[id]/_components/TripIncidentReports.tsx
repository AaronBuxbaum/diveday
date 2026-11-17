import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { getDb } from "@/db/client";
import { listTripIncidentReports } from "@/db/incident-reports";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { shopPath } from "@/lib/staff-notices";
import { startIncidentReportAction } from "../incidents/actions";

/**
 * **A departure's incident reports**, on On the water and Wrapped up (ADR
 * 20261012-incident-reports; ADR 20261117-trip-page-clock). The door to start one is here and only here on
 * the departure: the crew who were aboard, and owners and managers.
 *
 * Absent for anyone who may neither start one nor read one: a staffer not on
 * this boat sees no report and no door; the Activity line says only who filed
 * one. Read against the database on
 * every render: a crew change or a demotion takes effect at once.
 */
export async function TripIncidentReports({
  shop,
  personId,
  tripId,
}: {
  shop: { id: string; slug: string; timezone: string; defaultLocale: string };
  personId: string;
  tripId: string;
}) {
  const db = await getDb();
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const shopSlug = shop.slug;
  const timeZone = shop.timezone;
  const { mayStart, reports } = await listTripIncidentReports(db, shop.id, tripId, personId);
  if (!mayStart && reports.length === 0) return null;
  return (
    <section
      id="incidents"
      aria-labelledby="incidents-heading"
      className={`${sectionCardClass({ padding: "none" })} scroll-mt-24`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 pb-3 sm:px-6">
        <h2 id="incidents-heading" className="font-semibold">
          {t("incidents.trip.title")}
        </h2>
        {mayStart ? (
          <form action={startIncidentReportAction.bind(null, shopSlug, tripId)}>
            <SubmitButton
              pendingLabel={t("words.busy.opening")}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("incidents.trip.start")}
            </SubmitButton>
          </form>
        ) : null}
      </div>
      {reports.length > 0 ? (
        <ul className="divide-y divide-border border-t border-border">
          {reports.map((report) => (
            <li key={report.id}>
              <Link
                href={shopPath(shopSlug, "trips", tripId, "incidents", report.id)}
                className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 hover:underline sm:px-6"
              >
                <Badge size="sm" tone={report.status === "filed" ? "neutral" : "warning"}>
                  {t(
                    report.status === "filed" ? "incidents.status.filed" : "incidents.status.draft",
                  )}
                </Badge>
                <span className="font-medium">
                  {report.occurredAt
                    ? formatDateTimeTz(report.occurredAt, locale, timeZone)
                    : t("incidents.trip.notTimed")}
                </span>
                <span className="text-sm text-muted">
                  {t("incidents.trip.writtenBy", { name: report.createdByName })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
