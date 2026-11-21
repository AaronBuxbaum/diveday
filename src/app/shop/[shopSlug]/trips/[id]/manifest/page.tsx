import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BoatSafetyNotices } from "@/components/BoatSafetyNotices";
import { EmergencyReferenceCard } from "@/components/EmergencyReferenceCard";
import { OfflineManifestManager } from "@/components/OfflineManifestManager";
import { buttonClass } from "@/components/ui/button";
import { requireShopSurface } from "@/features/accounts/session";
import { recordManifestRead } from "@/features/platform/e2e-test-routes";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { runtimeMode } from "@/lib/runtime-mode";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { DeparturePaperIdentity } from "../_components/DeparturePaperIdentity";
import { RollCallCausalProvider } from "../_components/roll-call-causal-context";
import { BoatTabPaper } from "./_components/BoatTabPaper";
import { CancelledRollCallBanner } from "./_components/CancelledRollCallBanner";
import { CatchUpStrip } from "./_components/CatchUpStrip";
import { CheckpointSwitch } from "./_components/CheckpointSwitch";
import { DeckCountNote, DeckCountPanel } from "./_components/DeckCount";
import { DeckRollCall } from "./_components/DeckRollCall";
import { DockDesk } from "./_components/DockDesk";
import { deckAttentionNeeded } from "./_components/deck-attention";
import { deckCountView } from "./_components/deck-count-view";
import { executedDiveLogView } from "./_components/executed-dive-copy";
import { headCountView } from "./_components/head-count-view";
import { LiveRollCallConflicts } from "./_components/LiveRollCallConflicts";
import { ManifestDeviceSettings } from "./_components/ManifestDeviceSettings";
import { ManifestMilestones } from "./_components/ManifestMilestones";
import { ManifestRosterCommit } from "./_components/ManifestRosterCommit";
import { catchUpStripView, offlineManifestManagerCopy } from "./_components/manifest-copy";
import { readManifestHistoryCookie } from "./_components/manifest-history-cookie";
import type { ManifestSearchParams } from "./_components/manifest-search-params";
import { manifestSpecies } from "./_components/manifest-species";
import { readManifestView } from "./_components/manifest-view";
import { offlineManifestPayload } from "./_components/offline-payload";
import { PreDepartureCheckList } from "./_components/PreDepartureCheckList";
import { RosterFreshness } from "./_components/RosterFreshness";
import { SeenGroup } from "./_components/SeenGroup";
import { StageStrip } from "./_components/StageStrip";
import { SummaryPanel } from "./_components/SummaryPanel";
import { seenGroupView } from "./_components/seen-group-view";
import { TripPlanSection } from "./_components/TripPlanSection";
import { tripPlanRows } from "./_components/trip-plan-rows";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Roll call — DiveDay",
};

export default async function TripManifestPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<ManifestSearchParams>;
}) {
  const { shopSlug, id: tripId } = await params;
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(tripId)) notFound();
  const { checkpoint: requestedCheckpoint, buddyError } = await searchParams;
  const rosterRead = readManifestHistoryCookie((await headers()).get("cookie"), tripId);
  const { db, shop, session } = await requireShopSurface(shopSlug);
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  // Counts Roll call's own roster reads only; the Trip page reads the same view for its cards.
  if (runtimeMode().e2eHarness) recordManifestRead(tripId);
  // The readers and views this tab shares with the packet's manifest sheet.
  const view = await readManifestView({
    db,
    shop,
    session,
    shopSlug,
    tripId,
    requestedCheckpoint,
    buddyError,
    locale,
    t,
  });
  if (view.status === "missing") notFound();
  // A checkpoint this plan lacks leaves the address bar, never opening the dock (#2508).
  if (view.status === "stale") redirect(shopPath(shopSlug, "trips", tripId, "manifest"));
  const {
    boatCheck,
    plannedDives,
    executedDives,
    liveDiveSites,
    catchUp,
    meetingPoint,
    vessel,
    siteHistory,
    cancelled,
    fieldGuides,
    loggedSightings,
    shopPickedSpecies,
    reader,
    completeManifests,
    offlineRoster,
    departureManifest,
    boatSafety,
    checkpoint,
    isDeparture,
    manifest,
    actionContext,
    actions,
    emergencyCopy,
    emergencyReference,
    rollCall,
    boatPaper,
    checklistProps,
    stage,
    dockDesk,
    paperIdentity,
    deckCounts,
  } = view;
  const { catalogSpecies, speciesBySite } = manifestSpecies(locale, fieldGuides);
  // One definition, shared with the offline copy: divers *and* crew (DOM-H1,
  // ADR 20260804-crew-roll-call-is-per-person). This used to be written inline
  // here and again in OfflineManifestView as `totalDivers > 0 && awaiting === 0`,
  // which counted booked divers only — so a checkpoint could read complete with
  // a divemaster still in the water.
  const completeness = manifest.completeness;
  const headCount = headCountView({ manifest, checkpoint, isDeparture });
  // What the captain counted on deck, beside who is marked aboard (issue #4248).
  const deckCount = deckCountView(manifest, checkpoint, deckCounts);
  const seen = seenGroupView({
    checkpoint,
    actionContext,
    departureStartsAt: departureManifest.trip.startsAt,
    executedDives,
    plannedDives,
    loggedSightings,
    shopPickedSpecies,
    catalogSpecies,
    speciesBySite,
    sightingsOn: shop.sightingsEnabled,
    t,
  });
  const catchUpStrip = catchUpStripView(catchUp, locale, shop.timezone, t);
  const diveLog = isDeparture
    ? null
    : executedDiveLogView({
        plannedDives,
        executedDives,
        liveDiveSites,
        catalogSpecies,
        speciesBySite,
        locale,
        timeZone: shop.timezone,
        depthUnit: shop.depthUnit,
        t,
      });

  const renderId = randomUUID();
  return (
    <RollCallCausalProvider
      contexts={Object.fromEntries([
        ...manifest.divers.flatMap((row) =>
          row.rollCallContext ? [[`bookingId:${row.bookingId}`, row.rollCallContext]] : [],
        ),
        ...manifest.crew.flatMap((row) =>
          row.rollCallContext ? [[`personId:${row.id}`, row.rollCallContext]] : [],
        ),
      ])}
    >
      <DeparturePaperIdentity {...paperIdentity}>
        {/* On paper the Boat tab is this sheet alone, at the checkpoint on screen (#2745). */}
        <BoatTabPaper
          {...{ tripId, shop, shopSlug, checkpoint, paperIdentity, diveLog, cancelled, manifest }}
          {...{ boatSafety, rollCall, boatPaper, stage, dockDesk, t }}
          manifests={completeManifests}
          vesselName={vessel?.name ?? null}
          checklist={checklistProps}
        />
        <div className="boat-mode" data-roll-call-surface>
          <CancelledRollCallBanner state={cancelled} t={t} />
          <DeckRollCall
            exit={
              <Link
                href={shopPath(shopSlug, "trips", tripId)}
                className={buttonClass({ variant: "link", className: "min-h-11" })}
              >
                {t("manifest.deck.return")}
              </Link>
            }
            view={view}
            buddiesEnabled={shop.buddyTeamsEnabled}
            status={
              <>
                <RosterFreshness
                  {...{ tripId, locale }}
                  shop={shop}
                  sessionId={session.user.sessionId}
                  read={view}
                  checkpoint={checkpoint}
                  renderId={renderId}
                  rosterRead={rosterRead}
                  t={t}
                  compact
                />
                <DeckCountNote comparison={deckCount.comparison} t={t} />
                {/* The boat check sits with the dock count, open until it is done. */}
                {isDeparture ? (
                  <div className="mt-4">
                    <PreDepartureCheckList {...checklistProps} />
                  </div>
                ) : null}
              </>
            }
            // **The counts are tabs across the top** (ADR 20261117-trip-page-clock):
            // the dock, then one after each planned dive, so the count after a
            // dive is one tap away rather than behind More.
            checkpoint={
              <>
                {/* The tabs name the count and "Trip" leads back to the boat's
                    own page, so no title line spends a phone's height (ADR
                    20261114-trip-folio-and-individual-deck: routine roll call
                    fits one small phone screen). */}
                <CheckpointSwitch
                  manifests={completeManifests}
                  checkpoint={checkpoint}
                  shopSlug={shopSlug}
                  tripId={tripId}
                  t={t}
                />
              </>
            }
            attention={
              deckAttentionNeeded({ manifest, checkpoint, alerted: reader.alerted, headCount }) ? (
                <>
                  <SummaryPanel
                    checkpoint={checkpoint}
                    isDeparture={isDeparture}
                    rollCallComplete={completeness.complete}
                    completeness={completeness}
                    summary={manifest.summary}
                    {...headCount}
                    t={t}
                  />
                  <LiveRollCallConflicts
                    manifest={manifest}
                    actions={actions}
                    t={t}
                    locale={locale}
                    timeZone={shop.timezone}
                  />
                </>
              ) : undefined
            }
            details={
              <>
                <StageStrip action={actions.setTripStage} {...stage} />
                {catchUpStrip ? (
                  <CatchUpStrip {...catchUpStrip} dismissAction={actions.markTripCaughtUp} />
                ) : null}
                {boatSafety ? <BoatSafetyNotices {...boatSafety} /> : null}
                {isDeparture ? null : <PreDepartureCheckList {...checklistProps} />}
                {/* Informs, never gates (issue #4248). A cancelled departure's
                    roll call takes no writes, and neither does its count. */}
                {cancelled === "closed" ? null : (
                  <DeckCountPanel
                    action={actions.recordDeckCount}
                    counted={deckCount.counted}
                    comparison={deckCount.comparison}
                    t={t}
                  />
                )}
                <DockDesk {...dockDesk} />
                {isDeparture ? (
                  <TripPlanSection
                    heading={t("manifest.planChange.heading")}
                    {...tripPlanRows(t, shop, plannedDives, meetingPoint, siteHistory, locale)}
                  />
                ) : null}
                {/* Each dive's log is written on the Trip page, On the water, beside
                    the dive (one form, one place); the paper above still prints it. */}
                {!isDeparture && seen ? <SeenGroup {...seen} /> : null}
                <OfflineManifestManager
                  compact
                  locale={locale}
                  payload={offlineManifestPayload({
                    roster: offlineRoster,
                    shop: { ...shop, emergencyReference },
                    ...boatCheck,
                    boatSafety,
                    meetingWindows: view.stageStrip.meetingWindows,
                    locale,
                    t,
                  })}
                  copy={offlineManifestManagerCopy(t)}
                >
                  <ManifestDeviceSettings tripId={tripId} t={t} reader={reader} />
                </OfflineManifestManager>
                <EmergencyReferenceCard reference={emergencyReference} copy={emergencyCopy} />
                <ManifestMilestones
                  tripId={tripId}
                  checkpoint={checkpoint}
                  summary={manifest.summary}
                  complete={completeness.complete}
                  t={t}
                />
              </>
            }
          />
        </div>
      </DeparturePaperIdentity>
      <ManifestRosterCommit
        tripId={tripId}
        renderId={renderId}
        renderToken={rosterRead}
        checkpoint={checkpoint}
      />
    </RollCallCausalProvider>
  );
}
