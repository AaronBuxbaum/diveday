import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AGENCY_KEYS } from "@/app/shop/[shopSlug]/divers/[personId]/_components/shared";
import { ShopStat } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { canPersonExportIncidentRecord } from "@/db/authz";
import { getIncidentExport } from "@/db/incident-export";
import { rollCallCheckpointText } from "@/i18n/manifest-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatEvidenceDateTimeTz } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import type { RollCallCheckpoint } from "@/lib/manifests";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { DeparturePaperIdentity, formatPaperDateTime } from "../_components/DeparturePaperIdentity";
import { BoatAtDeparture } from "./_components/BoatAtDeparture";
import { CertificationEvidence } from "./_components/CertificationEvidence";
import { CrewAtDeparture } from "./_components/CrewAtDeparture";
import { CrewAwayWorkingLog } from "./_components/CrewAwayWorkingLog";
import { DepartureLogHeader } from "./_components/DepartureLogHeader";
import {
  DepartureLogClosing,
  DepartureLogFooter,
  DepartureLogFrame,
} from "./_components/DepartureLogPaper";
import { DepartureRoster } from "./_components/DepartureRoster";
import { ExecutedDivesTable } from "./_components/ExecutedDivesTable";
import { IncidentReportsSection } from "./_components/IncidentReportsSection";
import { incidentSummaryRows } from "./_components/incident-summary";
import { PreDepartureRecord } from "./_components/PreDepartureRecord";
import { rollCallCheckpointPrintClass } from "./_components/roll-call-columns";
import { NoRollCallNote, RosterIntro, TimelineGroups } from "./_components/TimelineEntryText";
import { WaiverLine, waiverHeaderText } from "./_components/WaiverLine";
import { matchesWaiverHeader, sharedWaiverHeader } from "./_components/waiver-evidence";

// `instant = true` asserts that navigating *into* this page paints immediately — the claim
// every trips/[id] sibling makes (ADR 20260804-instant-navigation): arriving from the home, the
// staff shell is already mounted and this segment's `loading.tsx` is what paints while the
// document assembles.
export const instant = true;

export const metadata: Metadata = {
  title: "Departure log — DiveDay",
};

/**
 * One departure's log: recorded facts only — boarding, the append-only
 * roll-call timeline, certification evidence as held, waiver *status* (never
 * medical answers) — each with its timestamp and recorder, plus a SHA-256
 * integrity code in the footer so a printout can be checked against a fresh
 * one. It is what a shop hands to authorities or insurers if a departure is
 * ever asked about.
 *
 * **Generated from the evening, not from the manifest.** It used to sit in the
 * manifest header, which is the surface a crew works *during* a departure —
 * an "incident-ready export" button beside "Mark boarded" reads as something
 * the day might need, on a page nobody should be reading prose on. Writing the
 * day's log is an evening act, so its door is a settled station on the shop
 * home (ADR 20260804-day-closeout; ADR 20260827-clearwater-surface-language,
 * decision 4), one per departure, beside the recap note.
 *
 * **Owner-only** (`canExportIncidentRecord`, src/lib/authz.ts), unlike the
 * manifest and the home it is reached from: the crew run the roll
 * call, but producing the shop's account of a departure — and having their own
 * name stamped on it as its generator — is the owner's call. Read-only:
 * nothing on this page mutates anything. Print-first: chrome is
 * `print:hidden`, everything else is plain bordered tables the `@media print`
 * monochrome treatment already handles (globals.css).
 */
export default async function IncidentExportPage({
  params,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
}) {
  const { shopSlug, id: tripId } = await params;
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(tripId)) notFound();
  const { session, db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  // Checked against the database, not the JWT, so a demoted owner loses this
  // immediately. A settled station hides the door for everyone else, but this
  // is the gate — the page refuses however it was reached. The landing is the
  // shop home with a reason on it: a refusal that teleports you somewhere
  // silently reads as a broken button (task 82).
  if (!(await canPersonExportIncidentRecord(db, shop.id, session.user.personId))) {
    redirect(noticeUrl(shopPath(shopSlug), "log-not-authorized"));
  }
  // Tenancy is the session's shop, never the URL: another shop's trip id — or
  // a stale slug — resolves to null and 404s.
  const doc = await getIncidentExport(db, shop.id, tripId, session.user.personId);
  if (!doc) notFound();

  const dateTime = (isoString: string) =>
    formatEvidenceDateTimeTz(new Date(isoString), locale, doc.meta.timezone);
  const checkpointText = (checkpoint: string) =>
    rollCallCheckpointText(t, checkpoint as RollCallCheckpoint);
  // A checkpoint column is pinned narrow on screen (`width="8rem"`) and on
  // paper (this share), so fixed layout stops splitting a roll-call table into
  // equal columns: "Awaiting roll call" had as much room as a buddy team,
  // which ran four and five lines. The text columns keep the rest.
  const checkpointPrintClass = rollCallCheckpointPrintClass(doc.meta.checkpoints.length);
  // The trail's names join in the reader's own locale, never a hard-coded ", ".
  const memberList = cachedListFormat(locale, { type: "conjunction" });
  const agencyText = (agency: string) =>
    t(AGENCY_KEYS[agency as keyof typeof AGENCY_KEYS] ?? AGENCY_KEYS.other);

  const summary = incidentSummaryRows(t, doc.departureSummary);
  const waiverHeader = sharedWaiverHeader(
    doc.roster.map((diver) => (diver.identityWithheld ? null : diver.waiver)),
  );

  // Section rhythm is the wrapper's, one `space-y-10`, and no section hangs a
  // margin of its own (docs/design/forms-and-controls.md): they used to step
  // `mt-7`, `mt-8`, `mt-10`, three gaps where the page has one.
  return (
    <DeparturePaperIdentity
      standaloneLog
      pageName={`departure-${tripId}-log`}
      identity={[
        doc.meta.shopName,
        doc.meta.tripTitle,
        `${formatPaperDateTime(new Date(doc.meta.tripStartsAt), locale, doc.meta.timezone)} · ${doc.meta.timezone}`,
        [doc.boatSafety?.boatName, t("incidentExport.title")].filter(Boolean).join(" · "),
      ]}
      printed={`${t("print.sheet.printed", { date: formatPaperDateTime(new Date(doc.meta.generatedAt), locale, doc.meta.timezone) })} · ${doc.meta.timezone}`}
    >
      <DepartureLogFrame>
        <DepartureLogHeader doc={doc} locale={locale} t={t} />

        <section aria-labelledby="incident-summary-heading">
          <h2 id="incident-summary-heading" className={SECTION_TITLE_CLASS}>
            {t("incidentExport.summaryHeading")}
          </h2>
          {/* A <dl>, deliberately: this is the definition-list half of the
            "table-and-definition-list document" the a11y scan expects, so a
            screen reader keeps the label-to-figure pairing on the record a
            shop hands an insurer. */}
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {summary.map(([label, value, detail]) => (
              <ShopStat key={label} definition label={label} value={value} detail={detail} />
            ))}
          </dl>
        </section>

        <section aria-labelledby="incident-roster-heading">
          <h2 id="incident-roster-heading" className={SECTION_TITLE_CLASS}>
            {t("incidentExport.rosterHeading")}
          </h2>
          <RosterIntro turnedAway={doc.turnedAway} t={t} />
          <DepartureRoster
            doc={doc}
            t={t}
            dateTime={dateTime}
            checkpointText={checkpointText}
            memberList={memberList}
            checkpointPrintClass={checkpointPrintClass}
          />
        </section>

        <CrewAtDeparture
          doc={doc}
          t={t}
          dateTime={dateTime}
          checkpointText={checkpointText}
          checkpointPrintClass={checkpointPrintClass}
        >
          <CrewAwayWorkingLog db={db} shopId={shop.id} tripId={tripId} t={t} dateTime={dateTime} />
        </CrewAtDeparture>

        {/* Absence is stated, never blank: a shop with no checklist defined says so, rather than the
          section simply not appearing; the two mean different things to an investigator. */}
        <section aria-labelledby="incident-checklist-heading">
          <h2 id="incident-checklist-heading" className={SECTION_TITLE_CLASS}>
            {t("incidentExport.checklistHeading")}
          </h2>
          <PreDepartureRecord
            checks={doc.preDepartureCheck}
            snags={doc.sailedWithSnags}
            t={t}
            dateTime={dateTime}
          />
        </section>

        <BoatAtDeparture doc={doc} locale={locale} dateTime={dateTime} t={t} />
        <section aria-labelledby="incident-evidence-heading">
          <h2 id="incident-evidence-heading" className={SECTION_TITLE_CLASS}>
            {t("incidentExport.evidenceHeading")}
          </h2>
          <p className="mt-1 max-w-prose text-sm text-muted">
            {t("incidentExport.evidenceDescription")}
          </p>
          {/* The release most of the boat signed, said once; a diver whose
            waiver differs keeps their whole sentence below (`waiver-evidence`). */}
          {waiverHeader ? (
            <p className="mt-2 max-w-prose text-sm font-medium">
              {waiverHeaderText(t, waiverHeader)}
            </p>
          ) : null}
          <ul
            className={sectionCardClass({
              padding: "none",
              className: "mt-3 divide-y divide-border",
            })}
          >
            {doc.roster.map((diver) => (
              <li key={diver.bookingId} className="break-inside-avoid px-4 py-3 sm:px-5">
                <p className="font-semibold">{diver.fullName}</p>
                {/* A held seat's release and cards would be the matched
                  person's (issue #2128): one sentence, never "not sent" or
                  "no cards", which would be wrong facts on this document. */}
                {diver.identityWithheld || !diver.waiver ? (
                  <p className="mt-1 text-sm text-muted">{t("incidentExport.identityWithheld")}</p>
                ) : (
                  <p className="mt-1 text-sm">
                    <WaiverLine
                      t={t}
                      waiver={diver.waiver}
                      dateTime={dateTime}
                      underHeader={matchesWaiverHeader(diver.waiver, waiverHeader)}
                    />
                  </p>
                )}
                <CertificationEvidence
                  diver={diver}
                  t={t}
                  agencyText={agencyText}
                  dateTime={dateTime}
                />
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="incident-executed-dive-heading">
          <h2 id="incident-executed-dive-heading" className={SECTION_TITLE_CLASS}>
            {t("incidentExport.executedDiveHeading")}
          </h2>
          <p className="mt-1 max-w-prose text-sm text-muted">
            {t("incidentExport.executedDiveDescription")}
          </p>
          {doc.executedDives.length === 0 ? (
            <p className="mt-3 text-sm font-semibold">{t("incidentExport.executedDiveEmpty")}</p>
          ) : (
            <ExecutedDivesTable
              dives={doc.executedDives}
              locale={locale}
              timeZone={doc.meta.timezone}
              t={t}
            />
          )}
        </section>

        <section aria-labelledby="incident-timeline-heading">
          <h2 id="incident-timeline-heading" className={SECTION_TITLE_CLASS}>
            {t("incidentExport.timelineHeading")}
          </h2>
          <p className="mt-1 max-w-prose text-sm text-muted">
            {t("incidentExport.timelineDescription")}
          </p>
          <NoRollCallNote timeline={doc.timeline} t={t} />
          {doc.timeline.length === 0 ? null : (
            <TimelineGroups
              timeline={doc.timeline}
              t={t}
              memberList={memberList}
              dateTime={dateTime}
              className={sectionCardClass({
                padding: "none",
                className: "mt-3 divide-y divide-border",
              })}
            />
          )}
        </section>

        <DepartureLogClosing emptyReports={doc.incidentReports.length === 0}>
          <IncidentReportsSection
            reports={doc.incidentReports}
            reportHref={(reportId) => shopPath(shopSlug, "trips", tripId, "incidents", reportId)}
            t={t}
            locale={locale}
            timeZone={doc.meta.timezone}
          />

          <DepartureLogFooter hash={doc.contentHash} version={doc.hashVersion} t={t} />
        </DepartureLogClosing>
      </DepartureLogFrame>
    </DeparturePaperIdentity>
  );
}
