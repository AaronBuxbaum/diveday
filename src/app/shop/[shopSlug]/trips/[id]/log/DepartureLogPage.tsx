import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { AGENCY_KEYS } from "@/app/shop/[shopSlug]/divers/[personId]/_components/shared";
import { ShopPageHeader, ShopStat } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { getTripLogPage } from "@/features/incident-export";
import type { requireShopSurface } from "@/features/session";
import { rollCallCheckpointText } from "@/i18n/manifest-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatEvidenceDateTimeTz } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import type { RollCallCheckpoint } from "@/lib/manifests";
import { PACKET_PAPER } from "@/lib/print-sheets";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { SheetDocument } from "../../../print/_components/SheetDocument";
import { sheetAttribution } from "../../../print/_components/ShopSheet";
import { DeparturePaperIdentity, formatPaperDateTime } from "../_components/DeparturePaperIdentity";
import { PacketSheet } from "../_components/packet/TripPacket";
import { BoatAtDeparture } from "./_components/BoatAtDeparture";
import { CertificationEvidence } from "./_components/CertificationEvidence";
import { CrewAtDeparture } from "./_components/CrewAtDeparture";
import { CrewAwayWorkingLog } from "./_components/CrewAwayWorkingLog";
import { DepartureLogHeader } from "./_components/DepartureLogHeader";
import { DepartureLogClosing, DepartureLogFooter } from "./_components/DepartureLogPaper";
import { DepartureRoster } from "./_components/DepartureRoster";
import { ExecutedDivesTable } from "./_components/ExecutedDivesTable";
import { IncidentReportsSection } from "./_components/IncidentReportsSection";
import { incidentSummaryRows } from "./_components/incident-summary";
import { PreDepartureRecord } from "./_components/PreDepartureRecord";
import { rollCallCheckpointClass } from "./_components/roll-call-columns";
import { NoRollCallNote, RosterIntro, TimelineGroups } from "./_components/TimelineEntryText";
import { WaiverLine, waiverHeaderText } from "./_components/WaiverLine";
import { matchesWaiverHeader, sharedWaiverHeader } from "./_components/waiver-evidence";

/** Recorded departure evidence, shared by the staff screen and its printable sheet. */
export async function DepartureLogPage({
  params,
  print = false,
  context,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  print?: boolean;
  context: Awaited<ReturnType<typeof requireShopSurface>>;
}) {
  const { shopSlug, id: tripId } = await params;
  const { session, db, shop } = context;
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  // Checked against the database, not the JWT, so a demoted owner loses this
  // immediately. A settled station hides the door for everyone else, but this
  // is the gate — the page refuses however it was reached. The landing is the
  // shop home with a reason on it: a refusal that teleports you somewhere
  // silently reads as a broken button (task 82).
  //
  // Tenancy is the session's shop, never the URL: another shop's trip id — or
  // a stale slug — resolves to null and 404s.
  const page = await getTripLogPage(db, shop.id, tripId, session.user.personId);
  if (!page.allowed) redirect(noticeUrl(shopPath(shopSlug), "log-not-authorized"));
  const { doc } = page;
  if (!doc) notFound();

  const dateTime = (isoString: string) =>
    formatEvidenceDateTimeTz(new Date(isoString), locale, doc.meta.timezone);
  const checkpointText = (checkpoint: string) =>
    rollCallCheckpointText(t, checkpoint as RollCallCheckpoint);
  // A checkpoint column takes a share of the sheet (`roll-call-columns.ts`),
  // so fixed layout stops splitting a roll-call table into equal columns:
  // "Awaiting roll call" had as much room as a buddy team, which ran four and
  // five lines. The text columns keep the rest.
  const checkpointClass = rollCallCheckpointClass(doc.meta.checkpoints.length);
  // The trail's names join in the reader's own locale, never a hard-coded ", ".
  const memberList = cachedListFormat(locale, { type: "conjunction" });
  const agencyText = (agency: string) =>
    t(AGENCY_KEYS[agency as keyof typeof AGENCY_KEYS] ?? AGENCY_KEYS.other);

  const summary = incidentSummaryRows(t, doc.departureSummary);
  const waiverHeader = sharedWaiverHeader(
    doc.roster.map((diver) => (diver.identityWithheld ? null : diver.waiver)),
  );

  const printed = `${sheetAttribution(t, formatPaperDateTime(new Date(doc.meta.generatedAt), locale, doc.meta.timezone), session.user.name)} · ${doc.meta.timezone}`;

  // Section rhythm is the wrapper's, one `space-y-6`, and no section hangs a
  // margin of its own (docs/design/forms-and-controls.md): they used to step
  // `mt-7`, `mt-8`, `mt-10`, three gaps where the page has one.
  const contents = (
    <div data-departure-log className="space-y-6">
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
          checkpointClass={checkpointClass}
        />
      </section>

      <CrewAtDeparture
        doc={doc}
        t={t}
        dateTime={dateTime}
        checkpointText={checkpointText}
        checkpointClass={checkpointClass}
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
      <section aria-labelledby="incident-evidence-heading" className="break-inside-avoid">
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
            <li key={diver.bookingId} className="break-inside-avoid px-5 py-3">
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
    </div>
  );
  if (!print)
    return (
      <StaffPage width="full">
        <ShopPageHeader
          title={t("incidentExport.title")}
          actions={
            <Link
              href={shopPath(shopSlug, "trips", tripId, "log", "print")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("print.sheet.door")}
            </Link>
          }
        />
        <Link
          href={`${shopPath(shopSlug, "trips", tripId)}?view=details`}
          className={buttonClass({ variant: "link", flush: true })}
        >
          {t("trips.surfaces.trip")}
        </Link>
        {contents}
      </StaffPage>
    );
  return (
    <SheetDocument
      backHref={shopPath(shopSlug, "trips", tripId)}
      paper={PACKET_PAPER}
      brandDisplayFont={shop.brandDisplayFont}
      backLabel={t("trips.surfaces.trip")}
      printLabel={t("print.sheet.door")}
      autoPrint={false}
    >
      <DeparturePaperIdentity
        standaloneLog
        pageName={`departure-${tripId}-log`}
        identity={[
          doc.meta.shopName,
          doc.meta.tripTitle,
          `${formatPaperDateTime(new Date(doc.meta.tripStartsAt), locale, doc.meta.timezone)} · ${doc.meta.timezone}`,
          [doc.boatSafety?.boatName, t("incidentExport.title")].filter(Boolean).join(" · "),
        ]}
        printed={printed}
      >
        <PacketSheet
          shop={{ name: doc.meta.shopName, brandColor: shop.brandColor }}
          shopSlug={shopSlug}
          name={t("incidentExport.title")}
          printed={printed}
        >
          {/* `data-departure-log` holds the body on the log's named page
              (`departurePaperRule`), so paper never ends on a sheet holding
              only a page number. */}
          {contents}
        </PacketSheet>
      </DeparturePaperIdentity>
    </SheetDocument>
  );
}
