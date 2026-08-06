import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MilestoneHaptics } from "@/components/MilestoneHaptics";
import { MissingDiversGrid, type MissingDiversGridCopy } from "@/components/MissingDiversGrid";
import {
  OfflineManifestManager,
  type OfflineManifestManagerCopy,
} from "@/components/OfflineManifestManager";
import { PrintButton } from "@/components/PrintButton";
import { PushOptIn, type PushOptInCopy } from "@/components/PushOptIn";
import { ShopNotice } from "@/components/ShopPageHeader";
import { SkipLink } from "@/components/SkipLink";
import { SubSurfaceRipple } from "@/components/SubSurfaceRipple";
import { buttonClass } from "@/components/ui/button";
import { WaterLocker, WaterLockerToggle } from "@/components/WaterLocker";
import { canPersonExportIncidentRecord } from "@/db/authz";
import { listTripBuddyTeams } from "@/db/buddy-pairs";
import { getDb } from "@/db/client";
import { getTripManifests } from "@/db/manifests";
import { getShopById } from "@/db/shops";
import { rollCallCheckpointText } from "@/i18n/manifest-labels";
import { readinessBlockerText } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import {
  isRollCallCheckpoint,
  type ManifestBuddyTeam,
  type RollCallCheckpoint,
  rollCallCheckpoints,
  splitBuddyTeamIds,
} from "@/lib/manifests";
import { webPushPublicKey } from "@/lib/notifications/web-push";
import { serializeManifests } from "@/lib/offline-manifests";
import { requireStaffSession } from "@/lib/session";
import { BuddyTeamsPanel } from "./_components/BuddyTeamsPanel";
import { CrewRollCall } from "./_components/CrewRollCall";
import { DiverRollCall } from "./_components/DiverRollCall";
import { SummaryPanel } from "./_components/SummaryPanel";
import { SummaryTiles } from "./_components/SummaryTiles";
import {
  addBuddyTeamMemberAction,
  crewRollCallAction,
  dissolveBuddyTeamAction,
  formBuddyTeamAction,
  isPushSubscribedAction,
  isPushSubscribedAnywhereAction,
  removeBuddyTeamMemberAction,
  rollCallAction,
  saveRollCallNoteAction,
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

export default async function TripManifestPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{ checkpoint?: string; buddyError?: string; notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, id: tripId } = await params;
  const { checkpoint: requestedCheckpoint, buddyError, notice } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop?.defaultLocale);
  const t = staffTranslator(locale);
  if (!shop) notFound();
  const completeManifests = await getTripManifests(db, shop.id, tripId);
  const departureManifest = completeManifests?.[0];
  if (!departureManifest || !completeManifests) notFound();
  // Raw membership rows, cancelled members included: the teams panel must show
  // a team whose seat was cancelled (it still blocks re-teaming the survivors
  // until dissolved), while the manifest derivation above already dropped that
  // member from every row's team (ADR 20260804-buddy-teams).
  const buddyTeamsList = await listTripBuddyTeams(db, shop.id, tripId);

  const plannedDives = departureManifest.trip.plannedDives;
  const checkpoints = rollCallCheckpoints(plannedDives);
  const checkpoint: RollCallCheckpoint =
    requestedCheckpoint && isRollCallCheckpoint(requestedCheckpoint, plannedDives)
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
  // The incident-ready export hands over the whole departure as evidence, so
  // it is owner-only (src/lib/authz.ts). Hide the door rather than offering a
  // link that 404s — the page re-checks the same gate itself.
  const canExportIncidentRecord = await canPersonExportIncidentRecord(
    db,
    shop.id,
    session.user.personId,
  );
  // Readiness gates boarding at departure only. After a dive, roll call is a
  // physical head count — a diver who is aboard is recorded present regardless
  // of a paperwork state that changed after the boat left.
  const isDeparture = checkpoint === "departure";
  // "Not boarded" is the dock's word for *never left*; after a dive the same
  // control means *did not return to the boat* (DOM-H3, `isNotBackAboard` in
  // src/lib/manifests.ts). One checkpoint-dependent word set for the tile, the
  // pill, and the button, so no surface can put a settled green check beside a
  // diver who is unaccounted for in the water.
  const notBoardedTileLabel = isDeparture
    ? t("trips.manifest.summaryNotBoarded")
    : t("trips.manifest.summaryNotBackAboard");
  const notBoardedTileValue = isDeparture
    ? manifest.summary.notBoarded
    : manifest.summary.notBackAboard;

  // Every mutation on this page lives in `./actions.ts` at module scope, bound
  // here to the departure and checkpoint it is about. That context used to be
  // captured from this render by inline `"use server"` closures — the same
  // sealed channel, said out loud — and each action re-proves what it is
  // handed rather than believing it (see the file's own note).
  const boundRollCallAction = rollCallAction.bind(null, shopSlug, tripId, checkpoint);
  const boundCrewRollCallAction = crewRollCallAction.bind(null, shopSlug, tripId, checkpoint);
  const boundSaveRollCallNoteAction = saveRollCallNoteAction.bind(null, shopSlug, tripId);

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
  // A count of split *teams*, not of rows wearing an alert: a team of four
  // with three back puts the alert on three rows, and the line says "N teams
  // are split" (`splitBuddyTeamIds`, src/lib/manifests.ts).
  const separatedTeams = isDeparture ? 0 : splitBuddyTeamIds(manifest, "separated_after_dive").size;
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
      ? t("trips.manifest.buddyErrorDuplicate")
      : buddyError === "teamed"
        ? t("trips.manifest.buddyErrorAlreadyTeamed")
        : buddyError === "few"
          ? t("trips.manifest.buddyErrorTooFew")
          : buddyError
            ? t("trips.manifest.buddyErrorGeneric")
            : null;

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
        guestsLink: (chunks) => (
          <Link href={`/shop/${shopSlug}/trips/${tripId}/guests#booking-${bookingId}`}>
            {chunks}
          </Link>
        ),
      }),
    };
  }

  return (
    <div>
      <SkipLink href="#roll-call-list" label={t("trips.manifest.skipToRollCall")} />
      <header className="flex flex-wrap items-end justify-between gap-5 border-b border-border pb-7 print:mt-0">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {manifest.trip.title}
          </h1>
          <p className="mt-1 text-muted">
            {formatShortDate(manifest.trip.startsAt, locale, shop.timezone)} ·{" "}
            {formatTimeRangeTz(manifest.trip.startsAt, manifest.trip.endsAt, locale, shop.timezone)}
          </p>
          {/* One line about what this page *is*. What to do at each checkpoint
              is said by the checkpoint nav and the "Active checkpoint" panel
              below, both of which name the current one; saying it a third time
              up here was the page explaining itself before it showed itself.
              The "Live manifest · save an offline copy below" badge went with
              it — the offline card is the next thing on screen and says so
              under its own heading. */}
          <p className="mt-2 max-w-prose text-sm text-muted print:hidden">
            {t("trips.manifest.description")}
          </p>
        </div>
        {/* `ms-auto` rather than the header's `justify-between` alone: once
            this cluster wraps onto its own line, a lone flex item on that line
            sits at the *start* of it, which is how Print / save PDF ended up
            on the left here and on the right on every other trip tab. Print is
            the last (rightmost) action on all of them. */}
        <div className="flex shrink-0 flex-wrap items-center gap-3 ms-auto print:hidden">
          {/* One tap to the hand-to-authorities document: the recorded
              manifest, roll-call timeline, cert evidence, and waiver status
              for this departure, print-ready with an integrity code. */}
          {canExportIncidentRecord ? (
            <Link
              href={`/shop/${shopSlug}/trips/${tripId}/incident-export`}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("incidentExport.openLink")}
            </Link>
          ) : null}
          <PrintButton label={t("shared.printButton.label")} />
        </div>
      </header>
      {/* Where the owner-only incident export lands everyone else. The link
          above is hidden for them, so this is for a bookmark, a deep link, or
          a role that changed under them. */}
      {notice === "incident_export_not_authorized" ? (
        <div className="mt-6 print:hidden">
          <ShopNotice tone="neutral" role="status">
            {t("incidentExport.ownerOnlyNotice")}
          </ShopNotice>
        </div>
      ) : null}
      <OfflineManifestManager
        locale={locale}
        payload={serializeManifests(
          completeManifests,
          { slug: shopSlug, name: shop.name, timezone: shop.timezone },
          (blocker) => readinessBlockerText(t, blocker),
        )}
        copy={
          {
            checkingDevice: t("trips.offlineManifestManager.checkingDevice"),
            reconcileRejectedOne: t("trips.offlineManifestManager.reconcileRejectedOne"),
            reconcileRejectedOther: t("trips.offlineManifestManager.reconcileRejectedOther"),
            reconcilePendingOne: t("trips.offlineManifestManager.reconcilePendingOne"),
            reconcilePendingOther: t("trips.offlineManifestManager.reconcilePendingOther"),
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
            savedSummary: t("trips.offlineManifestManager.savedSummary"),
            refreshingLabel: t("trips.offlineManifestManager.refreshingLabel"),
            refreshNowLabel: t("trips.offlineManifestManager.refreshNowLabel"),
            openOfflineRollCall: t("trips.offlineManifestManager.openOfflineRollCall"),
          } satisfies OfflineManifestManagerCopy
        }
        pushOptIn={
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
        }
      />

      <SummaryTiles
        summary={manifest.summary}
        notBoardedTileLabel={notBoardedTileLabel}
        notBoardedTileValue={notBoardedTileValue}
        t={t}
      />

      <nav
        className="mt-7 flex flex-wrap items-center gap-2 overflow-x-auto pb-2 print:hidden"
        aria-label={t("trips.manifest.checkpointNavAriaLabel")}
      >
        {checkpoints.map((value) => (
          <Link
            key={value}
            href={`/shop/${shopSlug}/trips/${tripId}/manifest?checkpoint=${value}`}
            scroll={false}
            className={buttonClass({
              variant: value === checkpoint ? "primary" : "secondary",
              size: "boat",
              className: "shrink-0",
            })}
          >
            {rollCallCheckpointText(t, value)}
          </Link>
        ))}
        <WaterLockerToggle
          copy={{ disableToggleLabel: t("shared.waterLocker.disableToggleLabel") }}
        />
      </nav>

      <SummaryPanel
        checkpoint={checkpoint}
        rollCallComplete={rollCallComplete}
        completeness={completeness}
        summary={manifest.summary}
        separatedTeams={separatedTeams}
        t={t}
      />

      {manifest.summary.blocked > 0 ? (
        <section className="mt-6 rounded-lg border border-warning/40 bg-warning/10 p-4">
          <h2 className="font-semibold text-warning">
            {t("trips.manifest.readinessNeedsAttention")}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {isDeparture
              ? t("trips.manifest.blockedDeparture", { count: manifest.summary.blocked })
              : t("trips.manifest.blockedAfterDive", { count: manifest.summary.blocked })}
          </p>
        </section>
      ) : null}

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

      <BuddyTeamsPanel
        buddyTeamsList={buddyTeamsList}
        diverOptions={diverOptions}
        crewOptions={crewOptions}
        unteamedDivers={unteamedDivers}
        buddyErrorText={buddyErrorText}
        formBuddyTeamAction={formBuddyTeamAction.bind(null, shopSlug, tripId, checkpoint)}
        addBuddyTeamMemberAction={addBuddyTeamMemberAction.bind(null, shopSlug, tripId, checkpoint)}
        removeBuddyTeamMemberAction={removeBuddyTeamMemberAction.bind(
          null,
          shopSlug,
          tripId,
          checkpoint,
        )}
        dissolveBuddyTeamAction={dissolveBuddyTeamAction.bind(null, shopSlug, tripId, checkpoint)}
        t={t}
      />

      <DiverRollCall
        divers={manifest.divers}
        checkpoint={checkpoint}
        isDeparture={isDeparture}
        shopSlug={shopSlug}
        tripId={tripId}
        locale={locale}
        timezone={shop.timezone}
        rollCallAction={boundRollCallAction}
        saveRollCallNoteAction={boundSaveRollCallNoteAction}
        rollCallButtonCopy={rollCallButtonCopy}
        buddyTeamLabel={buddyTeamLabel}
        t={t}
      />

      <MissingDiversGrid
        divers={manifest.divers
          .filter((diver) => !diver.rollCall)
          .map((diver) => ({
            bookingId: diver.bookingId,
            fullName: diver.fullName,
            rentsKit: diver.rentalFit.state === "rents",
          }))}
        copy={
          {
            heading: t("trips.manifest.missingDiversHeading", {
              count: manifest.divers.filter((diver) => !diver.rollCall).length,
            }),
            awaitingBoarding: t("trips.manifest.awaitingBoarding"),
            tapHint: t("trips.manifest.missingDiversTapHint"),
            rentsKitLabel: t("trips.manifest.rentsKitLabel"),
            ownKitLabel: t("trips.manifest.ownKitLabel"),
          } satisfies MissingDiversGridCopy
        }
      />

      <WaterLocker
        copy={{
          rainAlt: t("shared.waterLocker.rainAlt"),
          heading: t("shared.waterLocker.heading"),
          body: t("shared.waterLocker.body"),
          holdLine1: t("shared.waterLocker.holdLine1"),
          holdLine2: t("shared.waterLocker.holdLine2"),
          unlockingProgress: t("shared.waterLocker.unlockingProgress"),
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
