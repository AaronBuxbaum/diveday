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
import {
  catchUpStripView,
  emergencyReferenceCopy,
  offlineManifestManagerCopy,
} from "./_components/manifest-copy";
import { readManifestPage } from "./_components/manifest-reads";
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

/** What the manifest reads off its URL. */
type ManifestSearchParams = {
  checkpoint?: string;
  buddyError?: string;
  buddies?: string;
  /**
   * **Not part of this route's URL contract.** The paper day
   * (`/shop/[shopSlug]/print`) composes this page once per departure of
   * today, and duplicate element ids there silently point every
   * `aria-labelledby` and `#roll-call-list` jump at the *first* departure's
   * section (`src/lib/element-id.ts`). A page component's props are pinned
   * to Next's `PageProps`, so an extra prop is a build error and this is the
   * one channel a composing surface has.
   *
   * Narrowed by `uuidParam` below rather than trusted: anything that is not
   * a departure id is dropped, so a hand-typed `?idPrefix=` on this route
   * changes nothing.
   */
  idPrefix?: string;
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
    bookingNotes,
    diverNotes,
    checklistItems,
    checklistChecks,
    plannedDives,
    executedDives,
    liveDiveSites,
    catchUp,
    diveIntents,
    stage,
    meetingPoint,
    vessel,
    kitRecord,
    fieldGuides,
    loggedSightings,
    shopPickedSpecies,
  } = await readManifestPage(db, shop.id, tripId, session.user.personId);
  const { catalogSpecies, speciesBySite } = manifestSpecies(locale, fieldGuides);
  const departureManifest = completeManifests?.[0];
  if (!departureManifest || !completeManifests) notFound();
  const boatSafety = await departureBoatSafetySection(db, shop, departureManifest, t);

  const opened = openCheckpoint(completeManifests, departureManifest, requestedCheckpoint);
  // A checkpoint this plan lacks leaves the address bar, never opening the dock (#2508).
  if ("stale" in opened) redirect(shopPath(shopSlug, "trips", tripId, "manifest"));
  const { checkpoints, checkpoint, isDeparture, manifest } = opened;
  const todayTrailBySubject = personTrailIndex(completeManifests, locale, shop.timezone, t);
  // One definition, shared with the offline copy: divers *and* crew (DOM-H1,
  // ADR 20260804-crew-roll-call-is-per-person). This used to be written inline
  // here and again in OfflineManifestView as `totalDivers > 0 && awaiting === 0`,
  // which counted booked divers only — so a checkpoint could read complete with
  // a divemaster still in the water.
  const completeness = manifest.completeness;
  const rollCallComplete = completeness.complete;

  const actionContext: ManifestActionContext = { shopSlug, tripId, checkpoint };
  const actions = bindManifestActions(actionContext);
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
    t,
  });
  const catchUpStrip = catchUpStripView(catchUp, locale, shop.timezone, t);
  const checklist = preDepartureCheckView({
    checklistItems,
    checklistChecks,
    locale,
    timeZone: shop.timezone,
    t,
  });
  const buddyBuilder = buddyBuilderView({ manifest, buddyTeamsList, buddyError, locale, t });
  const { buddyTeamLabel } = buddyBuilder;
  const notesByBooking = manifestNoteThreads(bookingNotes, diverNotes);
  const { crewRollCallButtonCopy, rollCallButtonCopy } = rollCallCopies(t, shopSlug, tripId);
  const emergencyCopy = emergencyReferenceCopy(t);
  // This departure's own boat on every copy of the card, the shop line only without one (item 11).
  const emergencyReference = emergencyReferenceForDeparture(shop.emergencyReference, vessel);

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
        // No description line. "Divers and crew, with emergency contacts, at
        // every checkpoint" was a caption describing the page under a tab
        // that already names it — the checkpoint nav and the panel below say
        // what to do, and the per-row "Contact & gear" summaries carry the
        // emergency-contact discoverability it was keeping alive (the
        // copy-restraint question, applied 2026-08-21).
        // Printing is an Overall-tab action. The manifest is the live dock
        // surface; keeping a second current-page printer here made it unclear
        // whether staff were getting the full packet or only this tab.
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
        rollCallComplete={rollCallComplete}
        completeness={completeness}
        summary={manifest.summary}
        {...headCountView({ manifest, checkpoint, isDeparture })}
        t={t}
      />

      {/* **Where the boat is** — ADR 20260904-reef-all-the-way-down, decision
          2, Budget rule 4. Directly under the panel that counts the people
          aboard, because it is the same question asked of the boat rather than
          of the roster, and because the crew taps it at the rail. No drawing,
          no coral and no motion: this is a safety surface, and the boat that
          drifts on the home and the storefront is deliberately not here. */}
      <StageStrip
        action={actions.setTripStage}
        {...stageStripProps(t, {
          trip: departureManifest.trip,
          stage,
          now: nowDate(),
          timeZone: shop.timezone,
          locale,
        })}
      />

      <CheckpointSwitch
        checkpoints={checkpoints}
        checkpoint={checkpoint}
        shopSlug={shopSlug}
        tripId={tripId}
        t={t}
      />

      {/* **Every section from the boat check down, at one gap** (K-189). Each
          used to bring its own top margin — `mt-5`, `mt-8`, `mt-9` and back —
          so sections of one kind stepped 21 to 42px apart, and "Buddy teams"
          opened 64px under the plan. One `space-y-10` holds them and none
          carries a margin (docs/design/forms-and-controls.md); `mt-5` is the
          boat check's own step under the checkpoint switch it belongs to. */}
      <div className="mt-5 space-y-10">
        {/* One line, under the checkpoint switch: the boat check happens once
            before the boat leaves rather than once per dive, so it is the last
            thing above the roll call and the first thing to step back once it is
            done — open until then at the dock (UX audit 2026-10-07, item 17) (ADR 20260827-the-departure-is-two-working-surfaces, decision 2 —
            the boat-check items are a "one tap away" concern). It used to stand
            fully expanded *above* the checkpoint switch, five full-width buttons
            between the masthead and the head count at every checkpoint. */}
        {boatSafety ? <BoatSafetyNotices idPrefix={idPrefix} {...boatSafety} /> : null}
        <PreDepartureCheckList
          idPrefix={idPrefix}
          action={actions.preDepartureCheck}
          items={checklist.items}
          atDeparture={isDeparture}
          copy={checklist.copy}
        />
        {/* The page's job, as high as it can go: the divers, immediately under
            the panel that counts them. It used to be the *last* section, below
            the offline card, the tiles, the blocked banner, the crew and the
            whole buddy-team builder — so a captain on a phone scrolled past six
            screens of context to reach the first name at roll call. */}
        <DiverRollCall
          context={{
            idPrefix,
            divers: manifest.divers,
            crew: manifest.crew,
            checkpoint,
            isDeparture,
            shopSlug,
            tripId,
            locale,
            timezone: shop.timezone,
            notesByBooking,
            todayTrailByBooking: todayTrailBySubject,
            rollCallAction: actions.rollCall,
            addPrivateNoteAction: actions.addPrivateNote,
            rollCallButtonCopy,
            buddyTeamLabel,
            t,
          }}
        />

        {/* Crew close the checkpoint (DOM-H1) — they come straight after the
            divers, not before them: the divers are the head count's heart, and
            a two-person crew list ahead of nine divers read as the page's
            subject. */}
        <CrewRollCall
          crew={manifest.crew}
          idPrefix={idPrefix}
          divers={manifest.divers}
          checkpoint={checkpoint}
          isDeparture={isDeparture}
          shopSlug={shopSlug}
          tripId={tripId}
          locale={locale}
          timezone={shop.timezone}
          todayTrailBySubject={todayTrailBySubject}
          crewRollCallAction={actions.crewRollCall}
          crewRollCallButtonCopy={crewRollCallButtonCopy}
          buddyTeamLabel={buddyTeamLabel}
          t={t}
        />
        <DockDesk
          t={t}
          shopId={shop.id}
          tripId={tripId}
          isDeparture={isDeparture}
          trip={departureManifest.trip}
          timeZone={shop.timezone}
          stage={stage}
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
            {...tripPlanRows(t, shop, plannedDives, meetingPoint)}
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
          />
        ) : null}

        {/* **The living reef** — the crew's tally of what this departure saw,
            under the log they are already filling in and nowhere near the roll
            call's commit path or the head count above it. Nothing here gates
            anything; it reaches the shop's own public trip page. */}
        {!isDeparture && seen ? <SeenGroup idPrefix={idPrefix} {...seen} /> : null}

        {/* **The numbers a crew dials during** are a rare reference, behind the
            manifest-local ellipsis on a phone and a quiet footer line on desktop
            (ADR 20260827-the-departure-is-two-working-surfaces, decision 2). The
            printed manifest is the fallback under the fallback, so its complete
            copy is rendered outside either interactive disclosure below. */}
        <PrintedBoatPaper
          idPrefix={idPrefix}
          reference={emergencyReference}
          emergencyCopy={emergencyCopy}
          copy={printedBoatProcedureCopy(t)}
          kitRegister={printedKitRegister(kitRecord, t, locale)}
        />
        {/* Buddy teams are dock/desk prep, not mid-roll-call work: grouping
            people happens before the boat leaves, while the lists above are
            worked at the rail. Below the lists, still expanded — the teams
            themselves ride on each member's row where roll call can see them. */}
        <BuddyTeamsPanel
          idPrefix={idPrefix}
          defaultOpen={buddies === "open"}
          intentLine={staffDiveIntentLine(t, diveIntents, locale)}
          buddyTeamsList={buddyTeamsList}
          {...buddyBuilder.panel}
          {...actions.buddyTeams}
          t={t}
        />

        {/* Everything this *device* does, in **one line** at the foot of the
            page: hold an offline copy, wake itself for a refresh, ignore spray on
            the glass, buzz. All four are per-phone preferences rather than
            anything about this departure, and decision 2 of ADR
            20260827-the-departure-is-two-working-surfaces puts device settings in
            the "ashore, not here" tier.

            The disclosure belongs to `OfflineManifestManager` rather than to a
            wrapper here, and that is load-bearing: the summary line keeps the
            connectivity chip and the freshness pill on screen, because a stale
            copy that looks current is the failure mode this whole mechanism
            exists to prevent — and the component that computes that state is the
            only thing that can render it. The rest of the group rides in as its
            children. */}
        <OfflineManifestManager
          idPrefix={idPrefix}
          locale={locale}
          payload={offlineManifestPayload({
            completeManifests,
            shop: { ...shop, emergencyReference },
            shopSlug,
            checklistItems,
            checklistChecks,
            boatSafety,
            t,
          })}
          copy={offlineManifestManagerCopy(t)}
        >
          <ManifestDeviceSettings tripId={tripId} t={t} />
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
        complete={rollCallComplete}
        t={t}
      />
    </div>
  );
}
