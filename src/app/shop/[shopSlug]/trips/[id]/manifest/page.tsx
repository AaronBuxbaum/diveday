import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BoatSafetyNotices } from "@/components/BoatSafetyNotices";
import { EmergencyReferenceCard } from "@/components/EmergencyReferenceCard";
import { OfflineManifestManager } from "@/components/OfflineManifestManager";
import { SkipLink } from "@/components/SkipLink";
import { staffDiveIntentLine } from "@/i18n/dive-intent-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { scopedHash } from "@/lib/element-id";
import { emergencyReferenceForDeparture } from "@/lib/emergency-reference";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { TripPageHeader } from "../_components/TripPageHeader";
import { TripTabs } from "../_components/TripTabs";
import { tripTabsCopy } from "../_components/trip-tabs-copy";
import { BuddyTeamsPanel } from "./_components/BuddyTeamsPanel";
import { bindManifestActions } from "./_components/bound-actions";
import { buddyBuilderView } from "./_components/buddy-builder-view";
import { CancelledRollCallBanner } from "./_components/CancelledRollCallBanner";
import { CatchUpStrip } from "./_components/CatchUpStrip";
import { CheckpointSwitch } from "./_components/CheckpointSwitch";
import { CrewRollCall } from "./_components/CrewRollCall";
import { DiverRollCall } from "./_components/DiverRollCall";
import { DockDesk } from "./_components/DockDesk";
import { departureBoatSafetySection } from "./_components/departure-boat-safety";
import { ExecutedDiveLog } from "./_components/ExecutedDiveLog";
import { executedDiveLogView } from "./_components/executed-dive-copy";
import { headCountView } from "./_components/head-count-view";
import { ManifestDeviceSettings } from "./_components/ManifestDeviceSettings";
import { ManifestMilestones } from "./_components/ManifestMilestones";
import { ManifestMoreMenu } from "./_components/ManifestMoreMenu";
import { ManifestPaper } from "./_components/ManifestPaper";
import { manifestCanAssist } from "./_components/manifest-assist";
import {
  catchUpStripView,
  emergencyReferenceCopy,
  offlineManifestManagerCopy,
} from "./_components/manifest-copy";
import { readManifestPage } from "./_components/manifest-reads";
import { type ManifestSearchParams, PAPER_PACKET } from "./_components/manifest-search-params";
import { manifestSpecies } from "./_components/manifest-species";
import { offlineManifestPayload } from "./_components/offline-payload";
import { openCheckpoint } from "./_components/open-checkpoint";
import { PreDepartureCheckList } from "./_components/PreDepartureCheckList";
import {
  PrintedBoatPaper,
  printedBoatProcedureCopy,
  printedKitRegister,
} from "./_components/PrintedBoatProcedure";
import { PrintedSoulsOnBoard } from "./_components/PrintedSoulsOnBoard";
import { personTrailIndex } from "./_components/person-trail";
import { preDepartureCheckView } from "./_components/pre-departure-check-view";
import { rollCallCopies } from "./_components/roll-call-copy";
import { manifestRollCallProps } from "./_components/roll-call-props";
import { SeenGroup } from "./_components/SeenGroup";
import { manifestNoteThreads } from "./_components/StaffNotes";
import { StageStrip } from "./_components/StageStrip";
import { SummaryPanel } from "./_components/SummaryPanel";
import { seenGroupView } from "./_components/seen-group-view";
import { stageStripProps } from "./_components/stage-strip-props";
import { TripPlanSection } from "./_components/TripPlanSection";
import { tripPlanRows } from "./_components/trip-plan-rows";
import type { ManifestActionContext } from "./actions";

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
  const {
    checkpoint: requestedCheckpoint,
    buddyError,
    buddies,
    idPrefix: requestedIdPrefix,
    [PAPER_PACKET]: paper,
  } = await searchParams;
  const idPrefix = uuidParam(requestedIdPrefix ?? "") ?? undefined;
  const { db, shop, session } = await requireShopSurface(shopSlug);
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const {
    completeManifests,
    buddyTeamsList,
    partyPlan,
    bookingNotes,
    diverNotes,
    boatCheck,
    plannedDives,
    executedDives,
    liveDiveSites,
    catchUp,
    diveIntents,
    stageStrip,
    meetingPoint,
    vessel,
    kitRecord,
    siteHistory,
    cancelled,
    fieldGuides,
    loggedSightings,
    shopPickedSpecies,
    reader,
  } = await readManifestPage(db, shop.id, tripId, session.user.personId);
  const { catalogSpecies, speciesBySite } = manifestSpecies(locale, fieldGuides);
  const departureManifest = completeManifests?.[0];
  if (!departureManifest || !completeManifests) notFound();
  const boatSafety = await departureBoatSafetySection(db, shop, departureManifest, t, locale);

  const opened = openCheckpoint(completeManifests, departureManifest, requestedCheckpoint);
  // A checkpoint this plan lacks leaves the address bar, never opening the dock (#2508).
  if ("stale" in opened) redirect(shopPath(shopSlug, "trips", tripId, "manifest"));
  const { checkpoint, isDeparture, manifest } = opened;
  const todayTrailBySubject = personTrailIndex(completeManifests, locale, shop.timezone, t);
  // One definition, shared with the offline copy: divers *and* crew (DOM-H1,
  // ADR 20260804-crew-roll-call-is-per-person). This used to be written inline
  // here and again in OfflineManifestView as `totalDivers > 0 && awaiting === 0`,
  // which counted booked divers only — so a checkpoint could read complete with
  // a divemaster still in the water.
  const completeness = manifest.completeness;

  const actionContext: ManifestActionContext = { shopSlug, tripId, checkpoint };
  const actions = bindManifestActions(actionContext, reader, await searchParams);
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
    canAssist: await manifestCanAssist(db, shop.id, checkpoint === "departure"),
    sightingsOn: shop.sightingsEnabled,
    t,
  });
  const catchUpStrip = catchUpStripView(catchUp, locale, shop.timezone, t);
  const checklist = preDepartureCheckView({
    ...boatCheck,
    snagActions: vessel ? { note: actions.noteSnag, answer: actions.answerSnag } : undefined,
    locale,
    timeZone: shop.timezone,
    t,
  });
  const buddy = buddyBuilderView({ manifest, buddyTeamsList, buddyError, partyPlan, locale, t });
  const notesByBooking = manifestNoteThreads(bookingNotes, diverNotes);
  const emergencyCopy = emergencyReferenceCopy(t);
  // This departure's own boat on every copy of the card, the shop line only without one (item 11).
  const emergencyReference = emergencyReferenceForDeparture(shop.emergencyReference, vessel);
  const rollCall = manifestRollCallProps({
    idPrefix,
    manifest,
    checkpoint,
    isDeparture,
    shopSlug,
    tripId,
    locale,
    timezone: shop.timezone,
    notesByBooking,
    todayTrailBySubject,
    rollCallClosed: cancelled === "closed",
    actions,
    copies: rollCallCopies(t, shopSlug, tripId),
    buddyTeamLabel: buddy.buddyTeamLabel,
    t,
  });
  const printedBoatPaper = (
    <PrintedBoatPaper
      idPrefix={idPrefix}
      reference={emergencyReference}
      emergencyCopy={emergencyCopy}
      copy={printedBoatProcedureCopy(t)}
      kitRegister={printedKitRegister(kitRecord, t, locale)}
    />
  );
  const checklistProps = {
    idPrefix,
    action: actions.preDepartureCheck,
    atDeparture: isDeparture,
    ...checklist,
  };
  // Only the trip packet composes this page as paper (`ManifestPaper`, B03).
  if (paper) {
    return (
      <ManifestPaper
        cancelled={cancelled}
        manifest={manifest}
        vesselName={vessel?.name ?? null}
        boatSafety={boatSafety ? { idPrefix, ...boatSafety } : null}
        checklist={checklistProps}
        rollCall={rollCall}
        boatPaper={printedBoatPaper}
        t={t}
      />
    );
  }

  return (
    <div className="boat-mode">
      <SkipLink
        href={scopedHash(idPrefix, "roll-call-list")}
        label={t("manifest.skipToRollCall")}
        level="page"
      />
      {/* The same header the other three tabs wear (`TripPageHeader`). This
          page used to hand-roll its own, so switching to the Manifest redrew
          the top of the page for no reason a reader could act on.
          Deliberately without the seats badge the others carry: the whole body
          below is a live head count, and a "3 seats left" pill above a roll
          call reading "6 of 9 aboard" invites reading the seat count as a
          boarding count. */}
      <TripPageHeader
        boardHref={shopPath(shopSlug, "schedule", "board")}
        backLabel={t(STAFF_DESTINATION_LABEL_KEYS.board)}
        today={{ href: shopPath(shopSlug), label: t(STAFF_DESTINATION_LABEL_KEYS.today) }}
        trip={manifest.trip}
        locale={locale}
        timeZone={shop.timezone}
        // No description line: "Divers and crew, with emergency contacts, at
        // every checkpoint" captioned a page its tab already names; the
        // checkpoint nav and the panel below say what to do, and the per-row
        // summaries carry the contacts (copy-restraint, 2026-08-21).
        // Printing belongs to the trip's main tab; a second printer here
        // obscured whether it printed the full packet or only this live tab.
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
      <PrintedSoulsOnBoard manifest={manifest} vesselName={vessel?.name ?? null} t={t} />
      {/* **The catch-up strip**, under the masthead and above the instrument,
          exactly where the canvas draws it (ADR 20260904-reef-all-the-way-down
          slice 16d). It renders nothing when there is nothing new, and nothing
          at all to somebody who has never worked this departure — so on most
          openings of most manifests this line costs the page no pixels. */}
      {catchUpStrip ? (
        <CatchUpStrip
          idPrefix={idPrefix}
          {...catchUpStrip}
          dismissAction={actions.markTripCaughtUp}
        />
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
        idPrefix={idPrefix}
        checkpoint={checkpoint}
        isDeparture={isDeparture}
        rollCallComplete={completeness.complete}
        completeness={completeness}
        summary={manifest.summary}
        {...headCountView({ manifest, checkpoint, isDeparture })}
        t={t}
      />

      {/* **Where the boat is** — ADR 20260904-reef-all-the-way-down, decision
          2, Budget rule 4. Directly under the panel that counts the people
          aboard, because it is the same question asked of the boat rather than
          of the roster, and because the crew taps it at the rail. A safety
          surface: no drawing, no coral, no motion (`StageStrip`). */}
      <StageStrip
        action={actions.setTripStage}
        {...stageStripProps(t, {
          manifests: completeManifests,
          shopSlug,
          ...stageStrip,
          now: nowDate(),
          timeZone: shop.timezone,
          locale,
        })}
      />

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
        {boatSafety ? <BoatSafetyNotices idPrefix={idPrefix} {...boatSafety} /> : null}
        <PreDepartureCheckList {...checklistProps} />
        {/* The page's job, as high as it can go: the divers, immediately under
            the panel that counts them. It used to be the *last* section, below
            the offline card, the tiles, the blocked banner, the crew and the
            whole buddy-team builder — so a captain on a phone scrolled past six
            screens of context to reach the first name at roll call. */}
        <DiverRollCall context={rollCall.divers} />

        {/* Crew close the checkpoint (DOM-H1) — straight after the divers, not
            before them: the divers are the head count's heart, and a two-person
            crew list ahead of nine divers read as the page's subject. */}
        <CrewRollCall {...rollCall.crew} />
        <DockDesk
          t={t}
          shop={shop}
          tripId={tripId}
          isDeparture={isDeparture}
          trip={departureManifest.trip}
          stage={stageStrip.stage}
          seats={manifest.divers}
        />

        {/* **The plan** (issue #1184, D24).
            At the dock only: after a dive the log below owns this ground, and a
            read-only copy of the plan beside it would be a second answer to the
            same question. */}
        {isDeparture ? (
          <TripPlanSection
            idPrefix={idPrefix}
            heading={t("manifest.planChange.heading")}
            {...tripPlanRows(t, shop, plannedDives, meetingPoint, siteHistory, locale)}
          />
        ) : null}

        {!isDeparture ? (
          <ExecutedDiveLog
            idPrefix={idPrefix}
            {...executedDiveLogView({
              plannedDives,
              executedDives,
              liveDiveSites,
              catalogSpecies,
              speciesBySite,
              locale,
              timeZone: shop.timezone,
              depthUnit: shop.depthUnit,
              t,
            })}
            action={actions.saveExecutedDive}
            checkpoint={checkpoint}
            sightingsOn={shop.sightingsEnabled}
          />
        ) : null}

        {/* **The living reef**: what the crew saw, away from roll call and head count. It
            gates nothing, reaches the public trip page, and is gone while sightings are off. */}
        {!isDeparture && seen ? <SeenGroup idPrefix={idPrefix} {...seen} /> : null}

        {/* **The numbers a crew dials during** are a rare reference, behind the
            manifest-local ellipsis on a phone and a quiet footer line on desktop
            (ADR 20260827-the-departure-is-two-working-surfaces, decision 2). The
            printed manifest is the fallback under the fallback, so its complete
            copy is rendered outside either interactive disclosure below. */}
        {printedBoatPaper}
        {/* Buddy teams are dock/desk prep, not mid-roll-call work: grouping
            people happens before the boat leaves, while the lists above are
            worked at the rail. Below the lists, still expanded — the teams
            themselves ride on each member's row where roll call can see them. */}
        <BuddyTeamsPanel
          idPrefix={idPrefix}
          defaultOpen={buddies === "open"}
          intentLine={staffDiveIntentLine(t, diveIntents, locale)}
          buddyTeamsList={buddyTeamsList}
          {...buddy.panel}
          {...actions.buddyTeams}
          t={t}
        />

        {/* Everything this *device* does, in **one line** at the foot of the
            page: hold an offline copy, wake itself for a refresh, ignore spray on
            the glass, buzz. All four are per-phone preferences rather than
            anything about this departure, and decision 2 of ADR
            20260827-the-departure-is-two-working-surfaces puts device settings in
            the "ashore, not here" tier.

            The disclosure belongs to `OfflineManifestManager` rather than to a wrapper here, and
            that is load-bearing: the summary line keeps the connectivity chip and the freshness
            pill on screen, because a stale copy that looks current is the failure mode this whole
            mechanism exists to prevent — and the component that computes that state is the only
            thing that can render it. The rest of the group rides in as its children. */}
        <OfflineManifestManager
          idPrefix={idPrefix}
          locale={locale}
          payload={offlineManifestPayload({
            completeManifests,
            shop: { ...shop, emergencyReference },
            ...boatCheck,
            boatSafety,
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
  );
}
