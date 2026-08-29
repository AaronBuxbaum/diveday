import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AmbientContrastControl, AmbientGlareDetector } from "@/components/AmbientGlareDetector";
import { EmergencyReferenceCard } from "@/components/EmergencyReferenceCard";
import { HapticsToggle } from "@/components/HapticsToggle";
import { MilestoneHaptics } from "@/components/MilestoneHaptics";
import {
  OfflineManifestManager,
  type OfflineManifestManagerCopy,
} from "@/components/OfflineManifestManager";
import { PushOptIn, type PushOptInCopy } from "@/components/PushOptIn";
import { SkipLink } from "@/components/SkipLink";
import { SubSurfaceRipple } from "@/components/SubSurfaceRipple";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { WaterLocker, WaterLockerToggle } from "@/components/WaterLocker";
import { listTripBuddyTeams } from "@/db/buddy-pairs";
import { listDiveSites } from "@/db/dive-sites";
import { listExecutedDives } from "@/db/executed-dives";
import { getTripManifests } from "@/db/manifests";
import { listBookingNotes, listDiverNotesForTrip } from "@/db/operations";
import { latestPreDepartureChecksForTrip, listChecklistItems } from "@/db/pre-departure-check";
import type { ExecutedDive } from "@/db/schema";
import { listTripDives } from "@/db/trips";
import { rollCallCheckpointText } from "@/i18n/manifest-labels";
import { readinessBlockerText } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { type DepthUnit, depthInUnit } from "@/lib/depth-units";
import { formatDateTimeTz, formatTime, formatTimeRange } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import {
  isRollCallCheckpoint,
  type ManifestBuddyTeam,
  type RollCallCheckpoint,
  rollCallCheckpoints,
  rollCallRowState,
  splitBuddyTeamIds,
} from "@/lib/manifests";
import { webPushPublicKey } from "@/lib/notifications/web-push";
import { serializeManifests } from "@/lib/offline-manifests";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { shopPath } from "@/lib/staff-notices";
import { divesWithMatch } from "@/lib/support-needs";
import { uuidParam } from "@/lib/uuid";
import { TripPageHeader } from "../_components/TripPageHeader";
import { TripSurfaceNav } from "../_components/TripSurfaceNav";
import { BuddyTeamsPanel } from "./_components/BuddyTeamsPanel";
import { CrewRollCall } from "./_components/CrewRollCall";
import { DiverRollCall, type ManifestNote } from "./_components/DiverRollCall";
import { type ExecutedDiveLabels, ExecutedDiveLog } from "./_components/ExecutedDiveLog";
import { PreDepartureCheckList } from "./_components/PreDepartureCheckList";
import { SummaryPanel } from "./_components/SummaryPanel";
import {
  addBuddyTeamMemberAction,
  addManifestPrivateNoteAction,
  crewRollCallAction,
  dissolveBuddyTeamAction,
  formBuddyTeamAction,
  isPushSubscribedAction,
  isPushSubscribedAnywhereAction,
  type ManifestActionContext,
  preDepartureCheckAction,
  removeBuddyTeamMemberAction,
  rollCallAction,
  saveExecutedDiveAction,
  subscribePushAction,
  unsubscribePushAction,
} from "./actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Boat manifest — DiveDay",
};

/**
 * The one line a collapsed dive shows: "Dive 1 — not recorded yet", or
 * "Dive 1 — Molasses Reef, 18 m, 8:05 – 8:47".
 *
 * Composed here rather than in the component for the reason `diveLabel` is: it
 * needs the translator, the shop's depth unit and the shop's zone, and
 * `ExecutedDiveLog` is a Client Component with none of them.
 *
 * Every part is optional except the site, which always resolves — a saved row
 * with no actual site means staff recorded it as unknown, and that is itself
 * the answer. A part nobody entered is simply absent; the line never invents a
 * dash or a zero to stand in for it.
 */
function executedDiveSummary({
  diveLabel,
  row,
  locale,
  timeZone,
  depthUnit,
  t,
}: {
  diveLabel: string;
  row?: { executed: ExecutedDive; actualSite: { id: string; name: string } | null };
  locale: string;
  timeZone: string;
  depthUnit: DepthUnit;
  t: StaffTranslator;
}): string {
  if (!row) return t("manifest.executedDive.summaryNotRecorded", { dive: diveLabel });
  const parts: string[] = [row.actualSite?.name ?? t("manifest.executedDive.unknown")];
  const depth = row.executed.maxDepthMeters;
  if (depth != null && !row.executed.notRecorded.includes("depth")) {
    parts.push(
      t("manifest.executedDive.summaryDepth", {
        depth: depthInUnit(depth, depthUnit),
        unit: depthUnit === "feet" ? "ft" : "m",
      }),
    );
  }
  const { enteredAt, exitedAt } = row.executed;
  if (enteredAt && exitedAt) {
    parts.push(formatTimeRange(enteredAt, exitedAt, locale, timeZone));
  } else if (enteredAt) {
    parts.push(formatTime(enteredAt, locale, timeZone));
  }
  return t("manifest.executedDive.summaryRecorded", {
    dive: diveLabel,
    detail: parts.join(", "),
  });
}

/**
 * The dive log's words, resolved here and handed down: `ExecutedDiveLog` is a
 * Client Component (it shows a typed refusal beside the field that caused it),
 * and `staffTranslator` is server-side only.
 */
function executedDiveLabels(t: StaffTranslator, depthUnit: DepthUnit): ExecutedDiveLabels {
  return {
    heading: t("manifest.executedDive.heading"),
    actualSite: t("manifest.executedDive.actualSite"),
    unknown: t("manifest.executedDive.unknown"),
    maxDepth: t("manifest.executedDive.maxDepth", { unit: depthUnit === "feet" ? "ft" : "m" }),
    enteredAt: t("manifest.executedDive.enteredAt"),
    exitedAt: t("manifest.executedDive.exitedAt"),
    visibility: t("manifest.executedDive.visibility"),
    current: t("manifest.executedDive.current"),
    notRecordedDepth: t("manifest.executedDive.notRecordedDepth"),
    save: t("manifest.executedDive.save"),
    saved: t("manifest.executedDive.saved"),
    refusals: {
      times_transposed: t("manifest.executedDive.refusal.timesTransposed"),
      depth_out_of_range: t("manifest.executedDive.refusal.depthOutOfRange"),
      dive_number_out_of_range: t("manifest.executedDive.refusal.diveNumberOutOfRange"),
      unknown_site: t("manifest.executedDive.refusal.unknownSite"),
      unknown_trip: t("manifest.executedDive.refusal.unknownTrip"),
      unknown_recorder: t("manifest.executedDive.refusal.unknownRecorder"),
      invalid_time: t("manifest.executedDive.refusal.invalidTime"),
      invalid: t("manifest.executedDive.refusal.invalid"),
      wrong_dive: t("manifest.executedDive.refusal.wrongDive"),
    },
  };
}

export default async function TripManifestPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{
    checkpoint?: string;
    buddyError?: string;
    buddies?: string;
  }>;
}) {
  const { shopSlug, id: tripId } = await params;
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(tripId)) notFound();
  const { checkpoint: requestedCheckpoint, buddyError, buddies } = await searchParams;
  const { db, shop } = await requireShopSurface(shopSlug);
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  // The manifest rows, the raw team membership, and the desk's own notes don't
  // depend on one another — resolve them together instead of serially.
  const [
    completeManifests,
    buddyTeamsList,
    bookingNotes,
    diverNotes,
    checklistItems,
    checklistChecks,
    plannedDives,
    executedDives,
    liveDiveSites,
  ] = await Promise.all([
    getTripManifests(db, shop.id, tripId),
    // Raw membership rows, cancelled members included: the teams panel must show
    // a team whose seat was cancelled (it still blocks re-teaming the survivors
    // until dissolved), while the manifest derivation already dropped that
    // member from every row's team (ADR 20260804-buddy-teams).
    listTripBuddyTeams(db, shop.id, tripId),
    // The private staff notes written on the Trip surface. Read here, never
    // written here — see `StaffNotes`.
    listBookingNotes(db, shop.id, tripId),
    // Person-scoped notes written on the Diver record. Resolve them onto this
    // trip's booking below so every interface reads the same source of truth.
    listDiverNotesForTrip(db, shop.id, tripId),
    listChecklistItems(db, shop.id),
    latestPreDepartureChecksForTrip(db, shop.id, tripId),
    listTripDives(db, shop.id, tripId),
    listExecutedDives(db, shop.id, tripId),
    listDiveSites(db, shop.id),
  ]);
  const departureManifest = completeManifests?.[0];
  if (!departureManifest || !completeManifests) notFound();

  const plannedDiveCount = departureManifest.trip.plannedDives;
  const checkpoints = rollCallCheckpoints(plannedDiveCount);
  const checkpoint: RollCallCheckpoint =
    requestedCheckpoint && isRollCallCheckpoint(requestedCheckpoint, plannedDiveCount)
      ? requestedCheckpoint
      : "departure";
  const manifest = completeManifests.find((entry) => entry.checkpoint === checkpoint);
  if (!manifest) notFound();
  // One definition, shared with the offline copy: divers *and* crew (DOM-H1,
  // ADR 20260804-crew-roll-call-is-per-person). This used to be written inline
  // here and again in OfflineManifestView as `totalDivers > 0 && awaiting === 0`,
  // which counted booked divers only — so a checkpoint could read complete with
  // a divemaster still in the water.
  const completeness = manifest.completeness;
  const rollCallComplete = completeness.complete;
  // Readiness gates boarding at departure only. After a dive, roll call is a
  // physical head count — a diver who is aboard is recorded present regardless
  // of a paperwork state that changed after the boat left.
  const isDeparture = checkpoint === "departure";

  // Every mutation on this page lives in `./actions.ts` at module scope, bound
  // here to the departure and checkpoint it is about. That context used to be
  // captured from this render by inline `"use server"` closures — the same
  // sealed channel, said out loud — and each action re-proves what it is
  // handed rather than believing it (see the file's own note).
  // One named context object, bound once — `shopSlug` and `tripId` are both
  // opaque ids of the same shape, and as positional arguments swapping them was
  // a silent, well-typed mistake that revalidated another shop's route.
  const actionContext: ManifestActionContext = { shopSlug, tripId, checkpoint };
  const boundRollCallAction = rollCallAction.bind(null, actionContext);
  const boundCrewRollCallAction = crewRollCallAction.bind(null, actionContext);
  // The note carries its own checkpoint and the action re-proves it, so this
  // one takes the narrower context that has none.
  const boundAddPrivateNoteAction = addManifestPrivateNoteAction.bind(null, { shopSlug, tripId });
  const boundSaveExecutedDiveAction = saveExecutedDiveAction.bind(null, actionContext);
  // Same narrower context as the note above: the checklist is checkpoint-
  // independent, so its action re-proves nothing about which one was open.
  const boundPreDepartureCheckAction = preDepartureCheckAction.bind(null, { shopSlug, tripId });
  const checklistListItems = checklistItems.map((item) => {
    const check = checklistChecks.get(item.id);
    const checkedByLine = check
      ? t("trips.preDepartureCheck.checkedBy", {
          name: check.recordedByName,
          date: formatDateTimeTz(check.occurredAt, locale, shop.timezone),
        })
      : undefined;
    return {
      id: item.id,
      label: item.label,
      checkedByLine,
      // The trip packet's print stylesheet hides the interactive control
      // this item otherwise renders as (a <button>) — this whole sentence is
      // what survives on the printed sheet, composed here rather than in the
      // client component so word order and the separator stay a locale
      // choice, not a JSX literal's.
      printLine: checkedByLine
        ? t("trips.preDepartureCheck.printLineChecked", {
            label: item.label,
            status: checkedByLine,
          })
        : t("trips.preDepartureCheck.printLineNotChecked", { label: item.label }),
    };
  });

  // Who can still join a *new* team: any active roster entry not already on
  // one — including a member of a team whose other seat was cancelled, which
  // must be dissolved first (the server refuses it too; this just keeps the
  // picker honest). Crew are always offerable: one divemaster commonly leads
  // several groups on one boat, so they carry no "at most one team" rule.
  const teamedBookingIds = new Set(
    buddyTeamsList.flatMap((team) =>
      team.members.flatMap((member) => (member.kind === "diver" ? [member.bookingId] : [])),
    ),
  );
  const unteamedDivers = manifest.divers.filter((diver) => !teamedBookingIds.has(diver.bookingId));
  // Everyone the builder can offer, as `{ token, label }` — divers who are
  // free, and every assigned crew member.
  const diverOptions = unteamedDivers.map((diver) => ({
    token: `diver:${diver.bookingId}`,
    label: diver.fullName,
  }));
  const crewOptions = manifest.crew.map((member) => ({
    token: `crew:${member.id}`,
    label: member.fullName,
  }));
  // The "dives with" constraint, per booking, for the one surface that acts on
  // it (issue #1068). Matched against the whole departure — divers and crew,
  // since a diver may name the divemaster they always pair with — and worded
  // here because `BuddyTeamsPanel` has no translator.
  const rosterNames = [
    ...manifest.divers.map((diver) => diver.fullName),
    ...manifest.crew.map((member) => member.fullName),
  ];
  const divesWithByBooking = new Map(
    manifest.divers.flatMap((diver) => {
      const named = diver.supportNeeds?.divesWithName?.trim();
      if (!named) return [];
      const line =
        divesWithMatch(named, rosterNames) === "not_on_departure"
          ? t("manifest.buddyDivesWithNotBooked", { name: named })
          : t("manifest.buddyDivesWith", { name: named });
      return [[diver.bookingId, line] as const];
    }),
  );
  // A count of split *teams*, not of rows wearing an alert: a team of four
  // with three back puts the alert on three rows, and the line says "N teams
  // are split" (`splitBuddyTeamIds`, src/lib/manifests.ts).
  const separatedTeams = isDeparture ? 0 : splitBuddyTeamIds(manifest, "separated_after_dive").size;
  // Nobody has said anything about these divers at this checkpoint — the
  // summary panel's jump chips. Derived once, beside the counts they explain,
  // so the number and the names can never disagree.
  const uncalledDivers = manifest.divers.filter((diver) => !diver.rollCall);
  // The crew half of the same question. Crew reached the panel only as a count
  // before this — see `uncalledCrew` on `SummaryPanel`.
  const uncalledCrew = manifest.crew.filter((member) => !member.rollCall);
  // The other half of the same question, and the graver one: who has a stated
  // "did not come back" against their name. Read through `rollCallRowState`,
  // the one predicate the rows, the completeness verdict and the work queue
  // all share, so the panel's names and its counts can never disagree.
  const missingDivers = manifest.divers.filter(
    (diver) => rollCallRowState(checkpoint, diver.rollCall).notBackAboard,
  );
  const missingCrew = manifest.crew.filter(
    (member) => rollCallRowState(checkpoint, member.rollCall).notBackAboard,
  );
  // "Buddy team: Ana and Ben" — names de-duplicated (a divemaster on two teams
  // with one diver in common is still one body to look for) and joined through
  // `Intl.ListFormat` in the negotiated locale, never a hard-coded ", ".
  const teamNameList = cachedListFormat(locale, { type: "conjunction" });
  const buddyTeamLabel = (teams: ReadonlyArray<ManifestBuddyTeam>) => {
    const names = [...new Set(teams.flatMap((team) => team.others.map((o) => o.fullName)))];
    return names.length === 0
      ? null
      : t("shared.buddyTeam.with", { names: teamNameList.format(names) });
  };
  const buddyErrorText =
    buddyError === "duplicate"
      ? t("manifest.buddyErrorDuplicate")
      : buddyError === "teamed"
        ? t("manifest.buddyErrorAlreadyTeamed")
        : buddyError === "few"
          ? t("manifest.buddyErrorTooFew")
          : buddyError
            ? t("manifest.buddyErrorGeneric")
            : null;
  // A refusal renders beside the form that produced it
  // (docs/design/forms-and-controls.md). `few` is the one code only the
  // new-team builder can earn, so it lands in that fieldset's action row;
  // every other code can come from any of the per-team add/remove/dissolve
  // forms and has no single home, so it stays at the top of the panel.
  const buddyErrorForm = buddyErrorText ? (buddyError === "few" ? "builder" : "panel") : null;

  // One chronological note thread per booking. A person-scoped note and a
  // booking note are two contexts in the same `internal_notes` source, not two
  // lists the crew has to compare — the scope is retained only where it helps
  // explain why a note follows a diver beyond this departure.
  const notesByBooking = new Map<string, ManifestNote[]>();
  for (const { note, authorName } of bookingNotes) {
    if (!note.bookingId) continue;
    const rows = notesByBooking.get(note.bookingId) ?? [];
    rows.push({
      id: note.id,
      body: note.body,
      authorName,
      createdAt: note.createdAt,
      scope: "booking",
    });
    notesByBooking.set(note.bookingId, rows);
  }
  for (const { note, authorName, bookingId } of diverNotes) {
    const rows = notesByBooking.get(bookingId) ?? [];
    rows.push({
      id: note.id,
      body: note.body,
      authorName,
      createdAt: note.createdAt,
      scope: "diver",
    });
    notesByBooking.set(bookingId, rows);
  }
  for (const rows of notesByBooking.values()) {
    rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  const errorRefusal = t("trips.rollCall.errorRefusal");
  // Crew have no readiness, so the `not_ready` refusal can never be returned by
  // `crewRollCallAction` — the blocked message is the plain error for the same
  // reason the action collapses every server refusal into one: on a boat, the
  // only thing that matters is that the tap did not stick.
  const crewRollCallButtonCopy = { errorRefusal, blockedMessage: errorRefusal };
  // One `RollCallButtonCopy` per diver: the "not ready" refusal embeds a rich
  // link to that diver's own Guests anchor, so it is built here (server-side,
  // with `t.rich`) rather than reassembled from string fragments in the
  // Client Component — see the note on `RollCallButtonCopy`.
  function rollCallButtonCopy(bookingId: string) {
    return {
      errorRefusal,
      blockedMessage: t.rich("trips.rollCall.stillBlocked", {
        tripLink: (chunks) => (
          <Link href={`${shopPath(shopSlug, "trips", tripId)}#booking-${bookingId}`}>{chunks}</Link>
        ),
      }),
    };
  }

  return (
    <div className="boat-mode">
      <AmbientGlareDetector />
      <SkipLink href="#roll-call-list" label={t("manifest.skipToRollCall")} />
      {/* The same header the other three tabs wear (`TripPageHeader`). This
          page used to hand-roll its own — a smaller `<h1>`, a rule underneath,
          the date line at a different offset — so switching to the Manifest
          redrew the top of the page for no reason a reader could act on.
          Deliberately without the seats badge the others carry: the whole body
          below is a live head count, and a "3 spots left" pill above a roll
          call reading "6 of 9 aboard" invites reading the seat count as a
          boarding count. */}
      <TripPageHeader
        boardHref={shopPath(shopSlug, "schedule", "board")}
        backLabel={t(STAFF_DESTINATION_LABEL_KEYS.board)}
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
        subNav={<TripSurfaceNav shopSlug={shopSlug} tripId={tripId} locale={locale} />}
      />
      {/* Souls on board, on paper only. The printed manifest is the document
          that goes ashore with the dock or into a coastguard's hands, and the
          first question either asks is how many people the boat left with —
          which the screen answers with a live progress panel that does not
          print. Deliberately **static facts**: how many divers the trip
          carries and how many crew it names, never a live status count. A
          "Boarded 6" printed at 07:12 is a lie by 07:20 and paper cannot
          correct itself, so nothing here moves after the sheet comes off the
          printer. */}
      <p className="mt-4 hidden text-base font-semibold tabular-nums print:block">
        {t("manifest.soulsOnBoardLine", {
          divers: manifest.summary.totalDivers,
          crew: manifest.crew.length,
          souls: manifest.summary.totalDivers + manifest.crew.length,
        })}
      </p>
      {/* **The count leads** (ADR 20260827-the-departure-is-two-working-surfaces,
          decision 2: the count is "always on screen"). This is the page's only
          count surface — the checkpoint's progress, the numbers behind it, who
          is still to call by name, and every line that says a person is
          unaccounted for. It used to sit fourth, under an emergency band and a
          five-item checklist, so on a 390px phone the first thing a captain saw
          at the rail was a list of phone numbers for a call that has never been
          placed from this app. */}
      <SummaryPanel
        checkpoint={checkpoint}
        isDeparture={isDeparture}
        rollCallComplete={rollCallComplete}
        completeness={completeness}
        summary={manifest.summary}
        separatedTeams={separatedTeams}
        uncalled={uncalledDivers.map((diver) => ({
          bookingId: diver.bookingId,
          fullName: diver.fullName,
          blocked: diver.readiness.status === "blocked",
        }))}
        uncalledCrew={uncalledCrew.map((member) => ({
          id: member.id,
          fullName: member.fullName,
        }))}
        notBackAboardDivers={missingDivers.map((diver) => ({
          bookingId: diver.bookingId,
          fullName: diver.fullName,
        }))}
        notBackAboardCrew={missingCrew.map((member) => ({
          id: member.id,
          fullName: member.fullName,
        }))}
        t={t}
      />

      {/* A segmented control, not a row of buttons: the active checkpoint used
          to wear the same filled-primary costume as "Mark boarded", which gave
          the page a second primary that was not an action at all (principle
          8). The same shared track as the trip sub-nav (`SegmentedControl`),
          at boat size because this row is switched at the rail. */}
      <SegmentedControl
        ariaLabel={t("manifest.checkpointNavAriaLabel")}
        items={checkpoints.map((value) => ({
          key: value,
          label: rollCallCheckpointText(t, value),
          href: `/shop/${shopSlug}/trips/${tripId}/manifest?checkpoint=${value}`,
        }))}
        currentKey={checkpoint}
        size="boat"
        currentIsLink
        ariaCurrentValue="true"
        scroll={false}
        className="mt-7"
      />

      {/* One line, under the checkpoint switch: the boat check happens once
          before the boat leaves rather than once per dive, so it is the last
          thing above the roll call and the first thing to step back once it is
          done (ADR 20260827-the-departure-is-two-working-surfaces, decision 2 —
          the boat-check items are a "one tap away" concern). It used to stand
          fully expanded *above* the checkpoint switch, five full-width buttons
          between the masthead and the head count at every checkpoint. */}
      <PreDepartureCheckList
        action={boundPreDepartureCheckAction}
        items={checklistListItems}
        copy={{
          heading: t("trips.preDepartureCheck.heading"),
          summary: t("trips.preDepartureCheck.summary", {
            checked: checklistListItems.filter((item) => item.checkedByLine !== undefined).length,
            total: checklistListItems.length,
          }),
          errorRefusal: t("trips.preDepartureCheck.errorRefusal"),
        }}
      />
      {/* The page's job, as high as it can go: the divers, immediately under
          the panel that counts them. It used to be the *last* section, below
          the offline card, the tiles, the blocked banner, the crew and the
          whole buddy-team builder — so a captain on a phone scrolled past six
          screens of context to reach the first name at roll call. */}
      <DiverRollCall
        divers={manifest.divers}
        crewNames={manifest.crew.map((member) => member.fullName)}
        checkpoint={checkpoint}
        isDeparture={isDeparture}
        shopSlug={shopSlug}
        tripId={tripId}
        locale={locale}
        timezone={shop.timezone}
        notesByBooking={notesByBooking}
        rollCallAction={boundRollCallAction}
        addPrivateNoteAction={boundAddPrivateNoteAction}
        rollCallButtonCopy={rollCallButtonCopy}
        buddyTeamLabel={buddyTeamLabel}
        t={t}
      />

      {/* Crew close the checkpoint (DOM-H1) — they come straight after the
          divers, not before them: the divers are the head count's heart, and
          a two-person crew list ahead of nine divers read as the page's
          subject. */}
      <CrewRollCall
        crew={manifest.crew}
        checkpoint={checkpoint}
        isDeparture={isDeparture}
        shopSlug={shopSlug}
        tripId={tripId}
        locale={locale}
        timezone={shop.timezone}
        crewRollCallAction={boundCrewRollCallAction}
        crewRollCallButtonCopy={crewRollCallButtonCopy}
        buddyTeamLabel={buddyTeamLabel}
        t={t}
      />

      {!isDeparture ? (
        <ExecutedDiveLog
          planned={plannedDives.map(({ dive, diveSite }) => ({
            diveNumber: dive.diveNumber,
            diveSite: diveSite ? { id: diveSite.id, name: diveSite.name } : null,
            diveLabel: t("manifest.executedDive.dive", { number: dive.diveNumber }),
            plannedSiteLabel: t("manifest.executedDive.plannedSite", {
              site: diveSite?.name ?? t("manifest.executedDive.unknown"),
            }),
            summaryLine: executedDiveSummary({
              diveLabel: t("manifest.executedDive.dive", { number: dive.diveNumber }),
              row: executedDives.find((entry) => entry.executed.diveNumber === dive.diveNumber),
              locale,
              timeZone: shop.timezone,
              depthUnit: shop.depthUnit,
              t,
            }),
          }))}
          executed={executedDives}
          liveDiveSites={liveDiveSites.map((site) => ({ id: site.id, name: site.name }))}
          action={boundSaveExecutedDiveAction}
          labels={executedDiveLabels(t, shop.depthUnit)}
          timeZone={shop.timezone}
          depthUnit={shop.depthUnit}
          checkpoint={checkpoint}
        />
      ) : null}

      {/* **The numbers a crew dials during**, above the roster and on paper.
          This screen and its printout are what a crew has at the rail, and
          until issue #688 the only phone numbers on either were the ones you
          ring a diver's family on afterwards. Not `print:hidden`: paper is the
          fallback under the fallback, and a laminated card in the shop is worth
          nothing on the boat. */}
      <EmergencyReferenceCard
        className="mt-6"
        reference={shop.emergencyReference}
        copy={{
          heading: t("trips.emergency.heading"),
          empty: t("trips.emergency.empty"),
          vesselLabel: t("trips.emergency.vesselLabel"),
          shoreContactLabel: t("trips.emergency.shoreContactLabel"),
          planLabel: t("trips.emergency.planLabel"),
        }}
      />
      {/* Buddy teams are dock/desk prep, not mid-roll-call work: grouping
          people happens before the boat leaves, while the lists above are
          worked at the rail. Below the lists, still expanded — the teams
          themselves ride on each member's row where roll call can see them. */}
      <BuddyTeamsPanel
        defaultOpen={buddies === "open"}
        buddyTeamsList={buddyTeamsList}
        diverOptions={diverOptions}
        crewOptions={crewOptions}
        unteamedDivers={unteamedDivers}
        divesWithByBooking={divesWithByBooking}
        buddyErrorText={buddyErrorText}
        buddyErrorForm={buddyErrorForm}
        formBuddyTeamAction={formBuddyTeamAction.bind(null, actionContext)}
        addBuddyTeamMemberAction={addBuddyTeamMemberAction.bind(null, actionContext)}
        removeBuddyTeamMemberAction={removeBuddyTeamMemberAction.bind(null, actionContext)}
        dissolveBuddyTeamAction={dissolveBuddyTeamAction.bind(null, actionContext)}
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
        locale={locale}
        payload={serializeManifests(
          completeManifests,
          {
            slug: shopSlug,
            name: shop.name,
            timezone: shop.timezone,
            emergencyReference: shop.emergencyReference,
          },
          (blocker) => readinessBlockerText(t, blocker),
          checklistItems.map((item) => ({
            id: item.id,
            label: item.label,
            check: checklistChecks.get(item.id),
          })),
        )}
        copy={
          {
            checkingDevice: t("trips.offlineManifestManager.checkingDevice"),
            reconcileRejectedOne: t("trips.offlineManifestManager.reconcileRejectedOne"),
            reconcileRejectedOther: t.raw("trips.offlineManifestManager.reconcileRejectedOther"),
            reconcilePendingOne: t("trips.offlineManifestManager.reconcilePendingOne"),
            reconcilePendingOther: t.raw("trips.offlineManifestManager.reconcilePendingOther"),
            reconcileCaughtUp: t("trips.offlineManifestManager.reconcileCaughtUp"),
            reconcileErrorFallback: t("trips.offlineManifestManager.reconcileErrorFallback"),
            savingMessage: t("trips.offlineManifestManager.savingMessage"),
            saveErrorFallback: t("trips.offlineManifestManager.saveErrorFallback"),
            offlineWithSavedCopy: t("trips.offlineManifestManager.offlineWithSavedCopy"),
            offlineNoSavedCopy: t("trips.offlineManifestManager.offlineNoSavedCopy"),
            refreshNoSignal: t("trips.offlineManifestManager.refreshNoSignal"),
            heading: t("trips.offlineManifestManager.heading"),
            body: t("trips.offlineManifestManager.body"),
            connectivityOfflineWithCopy: t(
              "trips.offlineManifestManager.connectivityOfflineWithCopy",
            ),
            connectivityOffline: t("trips.offlineManifestManager.connectivityOffline"),
            connectivityOnline: t("trips.offlineManifestManager.connectivityOnline"),
            connectivityOnlineTitle: t("trips.offlineManifestManager.connectivityOnlineTitle"),
            connectivityOfflineTitle: t("trips.offlineManifestManager.connectivityOfflineTitle"),
            freshnessCurrent: t("trips.offlineManifestManager.freshnessCurrent"),
            freshnessAging: t("trips.offlineManifestManager.freshnessAging"),
            freshnessStale: t("trips.offlineManifestManager.freshnessStale"),
            savedSummary: t.raw("trips.offlineManifestManager.savedSummary"),
            refreshingLabel: t("trips.offlineManifestManager.refreshingLabel"),
            refreshNowLabel: t("trips.offlineManifestManager.refreshNowLabel"),
            openOfflineRollCall: t("trips.offlineManifestManager.openOfflineRollCall"),
            groupHeading: t("trips.onThisPhone"),
          } satisfies OfflineManifestManagerCopy
        }
      >
        <PushOptIn
          publicKey={webPushPublicKey()}
          subscribeAction={subscribePushAction.bind(null, tripId)}
          unsubscribeAction={unsubscribePushAction.bind(null, tripId)}
          isSubscribedAction={isPushSubscribedAction.bind(null, tripId)}
          isSubscribedAnyAction={isPushSubscribedAnywhereAction}
          copy={
            {
              heading: t("trips.offlineManifestManager.pushHeading"),
              body: t("trips.offlineManifestManager.pushBody"),
              enable: t("trips.offlineManifestManager.pushEnable"),
              enabling: t("trips.offlineManifestManager.pushEnabling"),
              disable: t("trips.offlineManifestManager.pushDisable"),
              on: t("trips.offlineManifestManager.pushOn"),
              unsupported: t("trips.offlineManifestManager.pushUnsupported"),
              homeScreenHint: t("trips.offlineManifestManager.pushHomeScreenHint"),
              denied: t("trips.offlineManifestManager.pushDenied"),
              error: t("trips.offlineManifestManager.pushError"),
            } satisfies PushOptInCopy
          }
        />

        {/* The spray guard is a *this device* preference like the two above it,
          not a checkpoint. It used to sit in the checkpoint nav, where it read
          as a fifth destination beside "Before departure" and "After dive 1"
          and put a settings toggle in the one row a captain taps to change
          what the page is showing — and then spent a while as a lone checkbox
          below the offline card, which is what this group fixes. */}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <WaterLockerToggle
            copy={{ disableToggleLabel: t("shared.waterLocker.disableToggleLabel") }}
            className="h-full"
          />
          {/* Renders nothing on a phone with no vibration motor — which is
            every iPhone (src/components/haptics.ts). */}
          <HapticsToggle copy={{ label: t("shared.haptics.toggleLabel") }} className="h-full" />
          <AmbientContrastControl
            className="rounded-xl border border-border bg-surface-sunken p-3"
            copy={{
              modeLabel: t("shared.boatMode.modeLabel"),
              labelAuto: t("shared.boatMode.labelAuto"),
              labelLand: t("shared.boatMode.labelLand"),
              labelBoat: t("shared.boatMode.labelBoat"),
            }}
          />
        </div>
      </OfflineManifestManager>

      <WaterLocker
        copy={{
          rainAlt: t("shared.waterLocker.rainAlt"),
          heading: t("shared.waterLocker.heading"),
          body: t("shared.waterLocker.body"),
          holdLine1: t("shared.waterLocker.holdLine1"),
          holdLine2: t("shared.waterLocker.holdLine2"),
          unlockingProgress: t.raw("shared.waterLocker.unlockingProgress"),
          holdToUnlock: t("shared.waterLocker.holdToUnlock"),
        }}
      />
      {/* Keyed by trip id + checkpoint: each holds a `prevPct`/`isInitial`
          (MilestoneHaptics) or `prevComplete` (SubSurfaceRipple) ref that
          assumes a monotonic same-trip-same-checkpoint lifecycle. Rendered
          once per manifest page, this route/key is otherwise identical
          across a trip or checkpoint switch, so if `cacheComponents: true`'s
          Activity-based navigation is ever re-enabled, an un-keyed instance
          could survive one and fire a false completion ripple/haptic buzz
          off the old numbers with no real remount to reset it (docs ADR
          20260801-cache-components-activity-state, currently reverted,
          commit 100fcf8). The `key` forces a full remount — and fresh refs — on either
          change. */}
      <MilestoneHaptics
        key={`${tripId}-${checkpoint}`}
        total={manifest.summary.totalDivers}
        boarded={manifest.summary.boarded}
      />
      <SubSurfaceRipple
        key={`${tripId}-${checkpoint}`}
        complete={rollCallComplete}
        copy={{
          iconTitle: t("shared.subSurfaceRipple.iconTitle"),
          message: t("shared.subSurfaceRipple.message"),
        }}
      />
    </div>
  );
}
