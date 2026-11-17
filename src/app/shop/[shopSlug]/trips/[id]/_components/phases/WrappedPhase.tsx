import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui/button";
import { listTripUnitsToCheckIn } from "@/db/gear";
import { listTripIncidentReports } from "@/db/incident-reports";
import type { TripGuests } from "@/features/trip-guests";
import { depthInUnit } from "@/lib/depth-units";
import { tripPacketPath } from "@/lib/print-sheets";
import { shopPath } from "@/lib/staff-notices";
import { readManifestView } from "../../manifest/_components/manifest-view";
import { recordTripPrintPdfAction } from "../../print-actions";
import { PrintTripBundleButton } from "../PrintTripBundleButton";
import { TripDiveRecord } from "../TripDiveRecord";
import { TripIncidentReports } from "../TripIncidentReports";
import { TripSentenceLine } from "../TripSentenceLine";
import type { TripSentence } from "../trip-sentence";
import { closeOutItems, wrappedSentence } from "../wrapped-close-out";
import type { PhaseRecordContext } from "./WaterPhase";
import { WrappedMore } from "./WrappedMore";
import { CloseOutCard, WhatHappenedCard } from "./WrappedPanels";
import { loggableDives, waterStandingOf } from "./water-reading";

/**
 * **Wrapped up** (ADR 20261117-trip-page-clock): the owner's phase once the
 * boat is back, and where a cancelled trip opens. The sentence says whether
 * the counts have everyone back and how much is left; then what is left, each
 * with its door; what happened; the dive logs and incident reports; the
 * guests as sailed; and, under More, what was found aboard, the conservation
 * record, the activity and the trip's links.
 */
export async function WrappedPhase({
  guests,
  roster,
  record,
  sentence,
  cancelled,
  door: hasDoor,
}: {
  guests: ReactNode;
  roster: TripGuests;
  record: PhaseRecordContext;
  sentence: TripSentence;
  cancelled: boolean;
  /** Whether Roll call has its dark door yet (`tripFrame`). */
  door: boolean;
}) {
  const { context, tripId, locale, t } = record;
  const { db, shop, session } = context;
  const personId = session.user.personId;
  const timeZone = shop.timezone;
  const words = { locale, timeZone, t };
  const door = hasDoor
    ? { href: shopPath(shop.slug, "trips", tripId, "manifest"), label: t("trips.clock.rollCall") }
    : null;
  const [view, rentalsOut, incidents] = await Promise.all([
    readManifestView({ ...context, shopSlug: shop.slug, tripId, locale, t }),
    cancelled ? [] : listTripUnitsToCheckIn(db, shop.id, tripId),
    listTripIncidentReports(db, shop.id, tripId, personId),
  ]);
  const reports = <TripIncidentReports shop={shop} personId={personId} tripId={tripId} />;
  const more = <WrappedMore record={record} roster={roster} />;
  const runAgain = (
    <Link
      href={shopPath(shop.slug, "schedule")}
      className={buttonClass({ variant: "link", flush: true })}
    >
      {t("trips.clock.wrapped.runAgain")}
    </Link>
  );
  if (view.status !== "ready") {
    return (
      <div data-phase-panel="wrapped" className="space-y-6 sm:space-y-10">
        <TripSentenceLine sentence={sentence} rollCall={door} />
        {reports}
        {guests}
        {more}
        {runAgain}
      </div>
    );
  }
  const standing = waterStandingOf(view);
  const items = closeOutItems({ standing, rentalsOut, reports: incidents.reports, cancelled });
  const stage = view.stageStrip.stage;
  const depth = (meters: number) =>
    t("manifest.executedDive.summaryDepth", {
      depth: depthInUnit(meters, shop.depthUnit),
      unit: shop.depthUnit === "feet" ? "ft" : "m",
    });
  const released = roster.roster.filter(({ booking }) => booking.status === "no_show");
  return (
    <div data-phase-panel="wrapped" className="space-y-6 sm:space-y-10">
      <TripSentenceLine
        sentence={wrappedSentence(
          standing,
          items,
          sentence,
          { ...words, cancelled, homeSaidAt: stage?.stage === "home" ? stage.recordedAt : null },
          t,
        )}
        // Roll call keeps its door on every cancelled trip too (the ADR): a
        // blow-out after the first tank still has a count to finish.
        rollCall={door}
      />
      <CloseOutCard items={items} shopSlug={shop.slug} tripId={tripId} locale={locale} t={t} />
      {cancelled && !standing.latest ? null : (
        <WhatHappenedCard
          standing={standing}
          depth={depth}
          reports={incidents.reports.length}
          mayReport={incidents.mayStart}
          noShows={released
            .filter(({ booking }) => !booking.turnedAwayAt)
            .map(({ person }) => person.fullName)}
          turnedAway={released
            .filter(({ booking }) => booking.turnedAwayAt)
            .map(({ person }) => person.fullName)}
          print={
            <PrintTripBundleButton
              href={tripPacketPath(shop.slug, tripId)}
              label={t("trips.clock.wrapped.print")}
              popupBlockedLabel={t("shared.printButton.popupBlocked")}
              recordAction={recordTripPrintPdfAction.bind(null, shop.slug, tripId)}
              flush
            />
          }
          {...words}
        />
      )}
      <TripDiveRecord
        view={view}
        dives={loggableDives(standing, { back: true })}
        shop={shop}
        tripId={tripId}
        locale={locale}
        t={t}
      />
      {reports}
      {guests}
      {more}
      {runAgain}
    </div>
  );
}
