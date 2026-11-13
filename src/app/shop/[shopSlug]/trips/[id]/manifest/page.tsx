import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { BoatSafetyNotices } from "@/components/BoatSafetyNotices";
import { EmergencyReferenceCard } from "@/components/EmergencyReferenceCard";
import { OfflineManifestManager } from "@/components/OfflineManifestManager";
import { SkipLink } from "@/components/SkipLink";
import { staffDiveIntentLine } from "@/features/dive-intent";
import { requireShopSurface } from "@/features/session";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { scopedHash } from "@/lib/element-id";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { DeparturePaperIdentity } from "../_components/DeparturePaperIdentity";
import { RollCallCausalProvider } from "../_components/roll-call-causal-context";
import { TripPageHeader } from "../_components/TripPageHeader";
import { TripTabs } from "../_components/TripTabs";
import { tripTabsCopy } from "../_components/trip-tabs-copy";
import { BoatTabPaper } from "./_components/BoatTabPaper";
import { BuddyTeamsPanel } from "./_components/BuddyTeamsPanel";
import { CancelledRollCallBanner } from "./_components/CancelledRollCallBanner";
import { CatchUpStrip } from "./_components/CatchUpStrip";
import { CheckpointSwitch } from "./_components/CheckpointSwitch";
import { CrewRollCall } from "./_components/CrewRollCall";
import { DiverRollCall } from "./_components/DiverRollCall";
import { DockDesk } from "./_components/DockDesk";
import { ExecutedDiveLog } from "./_components/ExecutedDiveLog";
import { executedDiveLogView } from "./_components/executed-dive-copy";
import { headCountView } from "./_components/head-count-view";
import { LiveRollCallConflicts } from "./_components/LiveRollCallConflicts";
import { ManifestDeviceSettings } from "./_components/ManifestDeviceSettings";
import { ManifestMilestones } from "./_components/ManifestMilestones";
import { ManifestMoreMenu } from "./_components/ManifestMoreMenu";
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
  title: "Boat manifest — DiveDay",
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
  const { checkpoint: requestedCheckpoint, buddyError, buddies } = await searchParams;
  const rosterRead = readManifestHistoryCookie((await headers()).get("cookie"), tripId);
  const { db, shop, session } = await requireShopSurface(shopSlug);
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
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
    buddyTeamsList,
    boatCheck,
    plannedDives,
    executedDives,
    liveDiveSites,
    catchUp,
    diveIntents,
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
    buddy,
    emergencyCopy,
    emergencyReference,
    rollCall,
    boatPaper,
    checklistProps,
    stage,
    dockDesk,
    paperIdentity,
  } = view;
  const { catalogSpecies, speciesBySite } = manifestSpecies(locale, fieldGuides);
  // One definition, shared with the offline copy: divers *and* crew (DOM-H1,
  // ADR 20260804-crew-roll-call-is-per-person). This used to be written inline
  // here and again in OfflineManifestView as `totalDivers > 0 && awaiting === 0`,
  // which counted booked divers only — so a checkpoint could read complete with
  // a divemaster still in the water.
  const completeness = manifest.completeness;
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
        <div className="boat-mode">
          <SkipLink
            href={scopedHash(undefined, "roll-call-list")}
            label={t("manifest.skipToRollCall")}
            level="page"
          />
          <TripPageHeader
            backLabel={t(STAFF_DESTINATION_LABEL_KEYS.board)}
            trip={manifest.trip}
            locale={locale}
            timeZone={shop.timezone}
            actionsClassName="lg:hidden"
            actions={
              <ManifestMoreMenu
                variant="header"
                label={t("manifest.emergencyMenuLabel")}
                closeLabel={t("manifest.closeEmergencyReference")}
              >
                {/* In the popover, which lifts it: no bed of its own. */}
                <EmergencyReferenceCard
                  className="mt-0"
                  headingId="emergency-reference-phone-heading"
                  inOverlay
                  reference={emergencyReference}
                  copy={emergencyCopy}
                />
              </ManifestMoreMenu>
            }
          />
          {/* No stage pill here: the crew's own stage strip below is this tab's
          reading of where the boat is, and a second one above it would be the
          same fact twice. */}
          <TripTabs shopSlug={shopSlug} tripId={tripId} current="boat" copy={tripTabsCopy(t)} />
          <CancelledRollCallBanner state={cancelled} t={t} />
          {/* **The catch-up strip**, under the masthead and above the instrument,
          exactly where the canvas draws it (ADR 20260904-reef-all-the-way-down
          slice 16d). It renders nothing when there is nothing new, and nothing
          at all to somebody who has never worked this departure — so on most
          openings of most manifests this line costs the page no pixels. */}
          {catchUpStrip ? (
            <CatchUpStrip {...catchUpStrip} dismissAction={actions.markTripCaughtUp} />
          ) : null}
          {/* **The count leads** (ADR 20260827-the-departure-is-two-working-surfaces,
          decision 2: the count is "always on screen"). This is the page's only
          count surface — the checkpoint's progress, the numbers behind it, and
          every line that says a person is
          unaccounted for. It used to sit fourth, under an emergency band and a
          five-item checklist, so on a 390px phone the first thing a captain saw
          at the rail was a list of phone numbers for a call that has never been
          placed from this app. */}
          <SummaryPanel
            checkpoint={checkpoint}
            isDeparture={isDeparture}
            rollCallComplete={completeness.complete}
            completeness={completeness}
            summary={manifest.summary}
            {...headCountView({ manifest, checkpoint, isDeparture })}
            t={t}
          />

          {/* **Where the boat is** — ADR 20260904-reef-all-the-way-down, decision
          2, Budget rule 4. Under the head count: the same question asked of
          the boat, tapped at the rail. A safety surface: no drawing, no coral,
          no motion (`StageStrip`). */}
          <StageStrip action={actions.setTripStage} {...stage} />

          <CheckpointSwitch
            manifests={completeManifests}
            checkpoint={checkpoint}
            shopSlug={shopSlug}
            tripId={tripId}
            t={t}
          />

          {/* **Every section from the boat check down, at one gap** (K-189). Each
          used to bring its own top margin — `mt-5`, `mt-8`, `mt-9` and back —
          so sections of one kind stepped 21 to 42px apart. One `space-y-10` holds
          them and none carries a margin (docs/design/forms-and-controls.md); `mt-5`
          is the boat check's own step under the checkpoint switch. */}
          <div className="mt-5 space-y-10">
            {/* One line, under the checkpoint switch: the boat check happens once
            before the boat leaves rather than once per dive, so it is the last
            thing above the roll call and the first thing to step back once it is
            done — open until then at the dock (UX audit 2026-10-07, item 17) (ADR 20260827-the-departure-is-two-working-surfaces, decision 2 —
            the boat-check items are a "one tap away" concern). It used to stand
            fully expanded *above* the checkpoint switch, five full-width buttons
            between the masthead and the head count at every checkpoint. */}
            {boatSafety ? <BoatSafetyNotices {...boatSafety} /> : null}
            <PreDepartureCheckList {...checklistProps} />
            {/* The page's job, as high as it can go: the divers, immediately under
            the panel that counts them. It used to be the *last* section, below
            the offline card, the tiles, the blocked banner, the crew and the
            whole buddy-team builder — so a captain on a phone scrolled past six
            screens of context to reach the first name at roll call. */}
            <LiveRollCallConflicts
              manifest={manifest}
              actions={actions}
              t={t}
              locale={locale}
              timeZone={shop.timezone}
            />
            <RosterFreshness
              {...{ tripId, locale }}
              shop={shop}
              sessionId={session.user.sessionId}
              read={view}
              checkpoint={checkpoint}
              renderId={renderId}
              rosterRead={rosterRead}
              t={t}
            />
            <DiverRollCall context={rollCall.divers} />

            {/* Crew close the checkpoint (DOM-H1) — straight after the divers, not
            before them: the divers are the head count's heart, and a two-person
            crew list ahead of nine divers read as the page's subject. */}
            <CrewRollCall {...rollCall.crew} />
            <DockDesk {...dockDesk} />

            {/* **The plan** (issue #1184, D24).
            At the dock only: after a dive the log below owns this ground, and a
            read-only copy of the plan beside it would be a second answer to the
            same question. */}
            {isDeparture ? (
              <TripPlanSection
                heading={t("manifest.planChange.heading")}
                {...tripPlanRows(t, shop, plannedDives, meetingPoint, siteHistory, locale)}
              />
            ) : null}

            {diveLog ? (
              <ExecutedDiveLog
                {...diveLog}
                action={actions.saveExecutedDive}
                checkpoint={checkpoint}
                sightingsOn={shop.sightingsEnabled}
              />
            ) : null}

            {/* **The living reef**: what the crew saw, away from roll call and head count. It
            gates nothing, reaches the public trip page, and is gone while sightings are off. */}
            {!isDeparture && seen ? <SeenGroup {...seen} /> : null}

            {/* **The numbers a crew dials during** are a rare reference, behind the
            manifest-local ellipsis on a phone and a quiet footer line on desktop
            (ADR 20260827-the-departure-is-two-working-surfaces, decision 2). The
            printed manifest is the fallback under the fallback: its complete
            copy is on the sheet above (`PrintedBoatPaper`). */}
            {/* Buddy teams are dock/desk prep, not mid-roll-call work: grouping
            people happens before the boat leaves, while the lists above are
            worked at the rail. Below the lists, still expanded — the teams
            themselves ride on each member's row where roll call can see them. */}
            <BuddyTeamsPanel
              defaultOpen={buddies === "open"}
              intentLine={staffDiveIntentLine(t, diveIntents, locale)}
              buddyTeamsList={buddyTeamsList}
              {...buddy.panel}
              {...actions.buddyTeams}
              t={t}
            />

            {/* Keep connectivity and copy freshness together in the device disclosure. */}
            <OfflineManifestManager
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
          </div>

          <ManifestMoreMenu
            variant="footer"
            label={t("manifest.emergencyMenuLabel")}
            closeLabel={t("manifest.closeEmergencyReference")}
          >
            <EmergencyReferenceCard
              className="mt-0"
              headingId="emergency-reference-desktop-heading"
              reference={emergencyReference}
              copy={emergencyCopy}
            />
          </ManifestMoreMenu>

          <ManifestMilestones
            tripId={tripId}
            checkpoint={checkpoint}
            summary={manifest.summary}
            complete={completeness.complete}
            t={t}
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
