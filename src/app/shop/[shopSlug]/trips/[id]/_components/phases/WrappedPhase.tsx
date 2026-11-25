import Link from "next/link";
import type { ReactNode } from "react";
import { activeCrewOn, diveNotMadeStanding } from "@/db/dive-not-made";
import { listFlySafeFollowUps } from "@/db/fly-safe-correction";
import { listTripUnitsToCheckIn } from "@/db/gear";
import { listTripIncidentReports } from "@/db/incident-reports";
import { listTripLostItems } from "@/features/day/lost-items";
import { getTripMoney } from "@/features/money/trip-money";
import type { TripGuests } from "@/features/trips/trip-guests";
import { canViewShopReports } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { depthInUnit } from "@/lib/depth-units";
import { tripPacketPath } from "@/lib/print-sheets";
import { seenSiteFor } from "@/lib/sightings";
import { shopPath } from "@/lib/staff-notices";
import { hasSailed } from "@/lib/trips";
import { readManifestView } from "../../manifest/_components/manifest-view";
import { recordTripPrintPdfAction } from "../../print-actions";
import { PrintTripBundleButton } from "../PrintTripBundleButton";
import { diveLogRows } from "../TripDiveRecord";
import { TripSentenceLine } from "../TripSentenceLine";
import { QUIET_ACTION } from "../trip-ink";
import type { TripSentence } from "../trip-sentence";
import { closeOutItems, notMadeOfferFor, wrappedSentence } from "../wrapped-close-out";
import { wrappedRecords } from "../wrapped-records";
import { UnplacedLine } from "./WaterPanels";
import type { PhaseRecordContext } from "./WaterPhase";
import { WrappedMore } from "./WrappedMore";
import { CloseOutCard, IncidentsLine, MoneyCard, WhatHappenedCard } from "./WrappedPanels";
import { WrappedRecordLinks } from "./WrappedRecordLinks";
import { loggableDives, waterStandingOf } from "./water-reading";

/**
 * **Wrapped up** (ADR 20261117-trip-page-clock): the owner's phase once the
 * boat is back, and where a cancelled trip opens. The sentence says whether
 * the counts have everyone back and how much is left; then what is left, each
 * with its door; what happened, one block whose dives open in place to their
 * logs, with the incident reports and a short row each for what was seen and
 * what was left aboard (issue #4683); the guests as listed; and, under More, what
 * was found aboard, the conservation record, the activity and the trip's links.
 * Roll call's door is the close-out row that needs it, or the header's link.
 * Crew on the departure may record a dive whose count never began as not made
 * from that row, and undo it from What happened (issue #4681).
 *
 * A cancelled trip that never sailed has no dives: its close-out (people put
 * aboard at the dock come ashore through the dock count), what was collected,
 * its incident reports, the guests and More.
 */
export async function WrappedPhase({
  guests,
  roster,
  record,
  sentence,
  cancelled,
}: {
  guests: ReactNode;
  roster: TripGuests;
  record: PhaseRecordContext;
  sentence: TripSentence;
  cancelled: boolean;
}) {
  const { context, tripId, locale, t } = record;
  const { db, shop, session } = context;
  const personId = session.user.personId;
  const timeZone = shop.timezone;
  const words = { locale, timeZone, t };
  const [view, rentalsOut, incidents, money, flySafe, lostItems, notMade, onCrew] =
    await Promise.all([
      readManifestView({ ...context, shopSlug: shop.slug, tripId, locale, t }),
      cancelled ? [] : listTripUnitsToCheckIn(db, shop.id, tripId),
      listTripIncidentReports(db, shop.id, tripId, personId),
      // The money record is for whoever may read the shop's reports.
      canViewShopReports(session.user.roles) ? getTripMoney(db, shop, tripId) : null,
      // This trip's own guests whose flying guidance needs a follow-up.
      listFlySafeFollowUps(db, { shopId: shop.id, tripId }),
      // What was left aboard, for What happened's row (issue #4683).
      shop.lostFoundEnabled && !cancelled ? listTripLostItems(db, shop.id, tripId) : [],
      // Dives crew recorded as not made (issue #4681), and whether this staffer may say so.
      diveNotMadeStanding(db, shop.id, tripId),
      cancelled ? false : activeCrewOn(db, { shopId: shop.id, tripId, personId }),
    ]);
  const ids = { shopSlug: shop.slug, tripId };
  const moneyCard = money ? (
    <MoneyCard money={money} cancelled={cancelled} locale={locale} t={t} />
  ) : null;
  const incidentsLine = <IncidentsLine incidents={incidents} {...ids} t={t} />;
  const more = <WrappedMore record={record} roster={roster} />;
  const runAgain = (
    <Link href={shopPath(shop.slug, "schedule")} className={QUIET_ACTION}>
      {t("trips.clock.wrapped.runAgain")}
    </Link>
  );
  const standing = view.status === "ready" ? waterStandingOf(view, notMade) : null;
  // The roll call cannot be read: what is left from every other record still shows.
  const items = closeOutItems({
    ...{ standing, rentalsOut, reports: incidents.reports, cancelled, flySafe },
  });
  // Crew on this departure may say the dive whose roll call is open was not made;
  // the offer is gone while anybody is missing or not recorded back.
  const notMadeDive = onCrew && standing ? notMadeOfferFor(standing, items) : null;
  const closeOut = (
    <CloseOutCard items={items} {...ids} notMadeDive={notMadeDive} locale={locale} t={t} />
  );
  if (!standing || view.status !== "ready" || cancelled) {
    const said =
      standing && view.status === "ready"
        ? wrappedSentence(standing, items, sentence, { ...words, cancelled, homeSaidAt: null }, t)
        : sentence;
    return (
      <div data-phase-panel="wrapped" className="space-y-6 sm:space-y-10">
        {/* A cancelled trip's own panel above says it, unless the counts have
            somebody not recorded back. */}
        {cancelled && said === sentence ? null : (
          <TripSentenceLine sentence={said} rollCall={null} />
        )}
        {closeOut}
        {moneyCard}
        {incidentsLine}
        {guests}
        <WrappedRecordLinks
          dives={[]}
          sightingDives={[]}
          shopSlug={shop.slug}
          tripId={tripId}
          sightingsEnabled={false}
          lostFoundEnabled={shop.lostFoundEnabled}
          t={t}
        />
        {more}
        {runAgain}
      </div>
    );
  }
  const stage = view.stageStrip.stage;
  const depth = (meters: number) =>
    t("manifest.executedDive.summaryDepth", {
      depth: depthInUnit(meters, shop.depthUnit),
      unit: shop.depthUnit === "feet" ? "ft" : "m",
    });
  const released = roster.roster.filter(({ booking }) => booking.status === "no_show");
  const said = wrappedSentence(
    standing,
    items,
    sentence,
    { ...words, cancelled, homeSaidAt: stage?.stage === "home" ? stage.recordedAt : null },
    t,
  );
  return (
    <div data-phase-panel="wrapped" className="space-y-6 sm:space-y-10">
      <TripSentenceLine sentence={said} rollCall={null} />
      {closeOut}
      <UnplacedLine standing={standing} locale={locale} t={t} />
      {/* What happened and Money side by side once there is room. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
        <WhatHappenedCard
          standing={standing}
          mayUndoNotMade={onCrew}
          depth={depth}
          logRow={diveLogRows({
            view,
            dives: loggableDives(standing, { back: true }),
            shop,
            tripId,
            locale,
            t,
          })}
          incidents={incidents}
          noShows={released
            .filter(({ booking }) => !booking.turnedAwayAt)
            .map(({ person }) => person.fullName)}
          turnedAway={released
            .filter(({ booking }) => booking.turnedAwayAt)
            .map(({ person }) => person.fullName)}
          records={wrappedRecords({
            sightingsOn: shop.sightingsEnabled,
            sightings: view.loggedSightings,
            dives: view.plannedDives.map(({ dive, diveSite }) => ({
              diveNumber: dive.diveNumber,
              recorded: view.executedDives.find(
                (row) => row.executed.diveNumber === dive.diveNumber,
              ),
              planned: diveSite,
            })),
            lostFoundOn: shop.lostFoundEnabled,
            lostItems,
          })}
          print={
            <PrintTripBundleButton
              href={tripPacketPath(shop.slug, tripId)}
              label={t("trips.clock.wrapped.print")}
              popupBlockedLabel={t("shared.printButton.popupBlocked")}
              recordAction={recordTripPrintPdfAction.bind(null, shop.slug, tripId)}
              flush
              link
            />
          }
          {...ids}
          {...words}
        />
        {moneyCard}
      </div>
      {guests}
      <WrappedRecordLinks
        dives={loggableDives(standing, { back: true }).filter((dive) =>
          view.completeManifests.some((manifest) => manifest.checkpoint === `after_dive_${dive}`),
        )}
        sightingDives={
          hasSailed(view.departureManifest.trip.startsAt, nowDate())
            ? view.completeManifests.flatMap(({ checkpoint }) => {
                const match = /^after_dive_(\d+)$/.exec(checkpoint);
                if (!match) return [];
                const dive = Number(match[1]);
                const site = seenSiteFor({
                  recorded: view.executedDives.find((row) => row.executed.diveNumber === dive),
                  planned:
                    view.plannedDives.find((row) => row.dive.diveNumber === dive)?.diveSite ?? null,
                });
                return site ? [dive] : [];
              })
            : []
        }
        shopSlug={shop.slug}
        tripId={tripId}
        sightingsEnabled={shop.sightingsEnabled}
        lostFoundEnabled={shop.lostFoundEnabled}
        t={t}
      />
      {more}
      {runAgain}
    </div>
  );
}
