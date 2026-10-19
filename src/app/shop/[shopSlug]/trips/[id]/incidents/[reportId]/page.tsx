import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import { listDiveSites } from "@/db/dive-sites";
import {
  getIncidentReport,
  listIncidentCrewChoices,
  listIncidentSeatChoices,
  listIncidentShopStaffChoices,
} from "@/db/incident-reports";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz, formatShortDate, formatTimeZoneName } from "@/lib/format";
import { incidentFilingGaps } from "@/lib/incident-reports";
import { requireShopSurface } from "@/lib/session";
import { noticeForForm, noticeFromParam, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import {
  addIncidentAddendumAction,
  addIncidentPersonAction,
  discardIncidentDraftAction,
  fileIncidentReportAction,
  markMissingDiverFoundAction,
  removeIncidentPersonAction,
  saveIncidentDraftAction,
  setIncidentLegalHoldAction,
} from "../actions";
import { IncidentDiscard, IncidentLegalHold } from "./_components/IncidentDecisions";
import { IncidentDraftForm } from "./_components/IncidentDraftForm";
import { IncidentPeople } from "./_components/IncidentPeople";
import { IncidentAddenda, IncidentFiling, IncidentRecord } from "./_components/IncidentRecord";
import { MissingDiverAlert } from "./_components/MissingDiverAlert";
import { manifestReturnHref } from "./_components/manifest-return";
import { INCIDENT_NOTICES } from "./_components/notices";

// Every trips/[id] sibling paints from its own `loading.tsx` (ADR
// 20260804-instant-navigation).
export const instant = true;

export const metadata: Metadata = {
  title: "Incident report — DiveDay",
};

/**
 * **One incident report** (ADR 20261012-incident-reports). Its writer edits
 * the draft here and files it; after filing it reads as a record and takes
 * dated notes. Owners and managers read every report; anyone else reaches
 * only the ones they started, and a report they may not read is a 404, the
 * same as one that does not exist.
 *
 * Nothing on this page is diver-facing, and nothing here is read by
 * readiness, roll call or booking: a report is a record, never a gate.
 */
export default async function IncidentReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string; reportId: string }>;
  searchParams: Promise<{ notice?: string; from?: string; checkpoint?: string }>;
}) {
  const { shopSlug, id: tripId, reportId } = await params;
  if (!uuidParam(tripId) || !uuidParam(reportId)) notFound();
  const { session, db, shop } = await requireShopSurface(shopSlug);
  const report = await getIncidentReport(db, shop.id, reportId, session.user.personId);
  if (!report || report.tripId !== tripId) notFound();

  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const tz = shop.timezone;
  const search = await searchParams;
  const { notice: noticeParam } = search;
  const backToManifest = manifestReturnHref(shopSlug, tripId, search);
  const definition = noticeFromParam(noticeParam, INCIDENT_NOTICES);
  const notice = definition
    ? { form: definition.form, tone: definition.tone, text: t(definition.key) }
    : undefined;

  const pageNotice = noticeForForm(notice, "page");
  const editing = report.status === "draft" && report.mayWrite;
  const [diveSites, seats, crew, shopStaff] = editing
    ? await Promise.all([
        listDiveSites(db, shop.id),
        listIncidentSeatChoices(db, shop.id, tripId),
        listIncidentCrewChoices(db, shop.id, tripId),
        listIncidentShopStaffChoices(db, shop.id, tripId),
      ])
    : [[], [], [], []];

  // Readable is writable (`mayWriteIncidentReport`): whoever reaches a draft
  // here may edit it.
  const description =
    report.status === "filed"
      ? t("incidents.page.filedNote", {
          name: report.filedByName ?? "",
          date: report.filedAt ? formatDateTimeTz(report.filedAt, locale, tz) : "",
        })
      : t("incidents.page.draftNote");

  return (
    <div className="space-y-10">
      <ShopPageHeader
        eyebrow={t("trips.surfaces.trip")}
        eyebrowHref={`${shopPath(shopSlug, "trips", tripId)}?view=details#incidents`}
        title={t("incidents.page.title")}
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge size="sm" tone={report.status === "filed" ? "neutral" : "warning"}>
              {t(report.status === "filed" ? "incidents.status.filed" : "incidents.status.draft")}
            </Badge>
            <span className="text-muted">
              {t("incidents.page.tripLine", {
                trip: report.tripTitle,
                date: formatShortDate(report.tripStartsAt, locale, tz),
              })}
            </span>
          </div>
        }
        description={description}
      />
      {/* Opened from the manifest's "Start a missing diver report": the roll
          call is still running, so the way back to it is the first thing
          under the title (domain review 2026-10-16). */}
      {backToManifest ? (
        <Link
          href={backToManifest}
          className={buttonClass({ variant: "secondary", className: "print:hidden" })}
        >
          {t("incidents.missingDiver.backToManifest")}
        </Link>
      ) : null}
      {/* Filing turns the form into a record, so its answer has no form left
          to stand in: it is the page's. */}
      <FormStatus tone={pageNotice?.tone}>{pageNotice?.text}</FormStatus>
      {report.ownersAlert ? (
        <MissingDiverAlert
          alert={report.ownersAlert}
          mayWrite={report.mayWrite}
          action={markMissingDiverFoundAction.bind(null, shopSlug, tripId, reportId)}
          locale={locale}
          timeZone={tz}
          t={t}
        />
      ) : null}

      {editing ? (
        <IncidentDraftForm
          fields={report.fields}
          diveSites={diveSites.map((site) => ({ id: site.id, name: site.name }))}
          timeZone={tz}
          zoneName={formatTimeZoneName(locale, tz)}
          action={saveIncidentDraftAction.bind(null, shopSlug, tripId, reportId)}
          notice={noticeForForm(notice, "draft")}
          t={t}
        />
      ) : (
        <IncidentRecord report={report} locale={locale} timeZone={tz} t={t} />
      )}

      <IncidentPeople
        people={report.people}
        editing={
          editing
            ? {
                seats,
                crew,
                shopStaff,
                addAction: addIncidentPersonAction.bind(null, shopSlug, tripId, reportId),
                removeAction: (rowId) =>
                  removeIncidentPersonAction.bind(null, shopSlug, tripId, reportId, rowId),
              }
            : null
        }
        notice={noticeForForm(notice, "people")}
        t={t}
      />

      {editing ? (
        <IncidentFiling
          gaps={incidentFilingGaps(report.fields)}
          missingDiver={report.fields.kind === "missing_diver"}
          action={fileIncidentReportAction.bind(null, shopSlug, tripId, reportId)}
          notice={noticeForForm(notice, "file")}
          t={t}
        />
      ) : null}

      {report.mayDecide && report.status === "draft" ? (
        <IncidentDiscard
          action={discardIncidentDraftAction.bind(null, shopSlug, tripId, reportId)}
          notice={noticeForForm(notice, "discard")}
          t={t}
        />
      ) : null}

      {report.status === "filed" ? (
        <IncidentAddenda
          addenda={report.addenda}
          locale={locale}
          timeZone={tz}
          action={
            report.mayWrite
              ? addIncidentAddendumAction.bind(null, shopSlug, tripId, reportId)
              : null
          }
          notice={noticeForForm(notice, "addenda")}
          t={t}
        />
      ) : null}

      {report.mayDecide && report.status === "filed" ? (
        <IncidentLegalHold
          held={report.legalHold}
          action={setIncidentLegalHoldAction.bind(
            null,
            shopSlug,
            tripId,
            reportId,
            !report.legalHold,
          )}
          notice={noticeForForm(notice, "hold")}
          t={t}
        />
      ) : null}
    </div>
  );
}
