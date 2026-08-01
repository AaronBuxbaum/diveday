import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import {
  RollCallButton,
  type RollCallResult,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton";
import { AmbientContrastSlider, AmbientGlareDetector } from "@/components/AmbientGlareDetector";
import { MilestoneHaptics } from "@/components/MilestoneHaptics";
import { MissingDiversGrid, type MissingDiversGridCopy } from "@/components/MissingDiversGrid";
import {
  OfflineManifestManager,
  type OfflineManifestManagerCopy,
} from "@/components/OfflineManifestManager";
import { PrintButton } from "@/components/PrintButton";
import { RollCallNote } from "@/components/RollCallNote";
import { SkipLink } from "@/components/SkipLink";
import { SubSurfaceRipple } from "@/components/SubSurfaceRipple";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { WaterLocker, WaterLockerToggle } from "@/components/WaterLocker";
import { getDb } from "@/db/client";
import { getTripManifests, recordRollCall, updateLatestRollCallNote } from "@/db/manifests";
import { getShopById } from "@/db/shops";
import { birthdayText } from "@/i18n/birthday-labels";
import { depthWarningText } from "@/i18n/depth-labels";
import { rollCallCheckpointText } from "@/i18n/manifest-labels";
import { readinessBlockerText } from "@/i18n/readiness-labels";
import { rentalFitLineText } from "@/i18n/rental-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { trackEvent } from "@/lib/analytics";
import { formatDateTimeTz, formatShortDate, formatTimeRangeTz } from "@/lib/format";
import {
  isRollCallCheckpoint,
  type RollCallCheckpoint,
  rollCallCheckpoints,
  rollCallLabel,
} from "@/lib/manifests";
import { serializeManifests } from "@/lib/offline-manifests";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Boat manifest — DiveDay",
};

// Shared structure for every roll-call button below (design/forms-and-controls.md's
// dock target, `buttonClass({ size: "boat" })`'s min-h-14, plus the boat-mode press
// feedback) — kept as one constant here so the four state variants below can't
// drift out of sync with each other the way two separate call sites once did.
const BOAT_TARGET_CLASS =
  "flex min-h-14 w-full touch-manipulation items-center justify-center rounded-lg px-5 text-base font-semibold transition-[transform,opacity] active:scale-[0.99] disabled:cursor-wait disabled:opacity-70";

const rollCallSchema = z.object({
  bookingId: z.string().uuid(),
  status: z.enum(["boarded", "not_boarded", "cleared"]),
  note: z.string().trim().max(300).optional(),
});

const noteSchema = z.object({
  bookingId: z.string().uuid(),
  checkpoint: z.string(),
  note: z.string().max(300),
});

export default async function TripManifestPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{ checkpoint?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, id: tripId } = await params;
  const { checkpoint: requestedCheckpoint } = await searchParams;
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

  const plannedDives = departureManifest.trip.plannedDives;
  const checkpoints = rollCallCheckpoints(plannedDives);
  const checkpoint: RollCallCheckpoint =
    requestedCheckpoint && isRollCallCheckpoint(requestedCheckpoint, plannedDives)
      ? requestedCheckpoint
      : "departure";
  const manifest = completeManifests.find((entry) => entry.checkpoint === checkpoint);
  if (!manifest) notFound();
  const rollCallComplete = manifest.summary.totalDivers > 0 && manifest.summary.awaiting === 0;
  // Readiness gates boarding at departure only. After a dive, roll call is a
  // physical head count — a diver who is aboard is recorded present regardless
  // of a paperwork state that changed after the boat left.
  const isDeparture = checkpoint === "departure";
  const back = `/shop/${shopSlug}/trips/${tripId}/manifest?checkpoint=${checkpoint}`;

  async function rollCallAction(
    _prev: RollCallResult,
    formData: FormData,
  ): Promise<RollCallResult> {
    "use server";
    const staff = await requireStaffSession();
    const parsed = rollCallSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, reason: "error" };
    // A throw or dropped connection returns the worded rollback rather than
    // rejecting the action, which would silently revert the card on flaky Wi-Fi.
    try {
      const outcome = await recordRollCall(await getDb(), {
        shopId: staff.user.shopId,
        tripId,
        bookingId: parsed.data.bookingId,
        recordedByPersonId: staff.user.personId,
        status: parsed.data.status,
        checkpoint,
        note: parsed.data.note,
      });
      if (!outcome.ok) {
        if (outcome.reason === "not_ready") {
          await trackEvent({ name: "roll_call_blocked", checkpoint });
          return { ok: false, reason: "not_ready" };
        }
        return { ok: false, reason: "error" };
      }
    } catch {
      return { ok: false, reason: "error" };
    }
    // Settle the card in place instead of a full-page redirect per tap.
    revalidatePath(back.split("?")[0]);
    return { ok: true };
  }

  async function saveRollCallNoteAction(
    bookingId: string,
    checkpointValue: string,
    note: string,
  ): Promise<{ ok: boolean; saved: boolean }> {
    "use server";
    const staff = await requireStaffSession();
    const parsed = noteSchema.safeParse({ bookingId, checkpoint: checkpointValue, note });
    if (!parsed.success) return { ok: false, saved: false };
    if (!isRollCallCheckpoint(parsed.data.checkpoint, plannedDives)) {
      return { ok: false, saved: false };
    }
    const saved = await updateLatestRollCallNote(await getDb(), {
      shopId: staff.user.shopId,
      tripId,
      bookingId: parsed.data.bookingId,
      checkpoint: parsed.data.checkpoint,
      note: parsed.data.note,
    });
    if (saved) revalidatePath(back.split("?")[0]);
    return { ok: true, saved };
  }

  const errorRefusal = t("trips.rollCall.errorRefusal");
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
    <div className="boat-mode">
      <AmbientGlareDetector />
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
          <p className="mt-2 max-w-prose text-sm text-muted print:hidden">
            {t.rich("trips.manifest.description", {
              strong: (chunks) => <span className="font-semibold text-foreground">{chunks}</span>,
            })}
          </p>
          <p className="mt-3 flex flex-wrap gap-2 print:hidden">
            <Badge tone="primary">{t("trips.manifest.liveManifestBadge")}</Badge>
            <span className="glare-mode-indicator rounded-full bg-foreground/10 px-3 py-1 text-sm font-medium text-foreground ring-1 ring-inset ring-foreground/20">
              {t("trips.manifest.glareModeActive")}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-4 print:hidden">
          <AmbientContrastSlider
            copy={{
              contrastAutoFallback: t("shared.ambientContrast.contrastAutoFallback"),
              contrastIconTitle: t("shared.ambientContrast.contrastIconTitle"),
              contrastLabel: t("shared.ambientContrast.contrastLabel"),
              labelAuto: t("shared.ambientContrast.labelAuto"),
              labelStandard: t("shared.ambientContrast.labelStandard"),
              labelFullAaa: t("shared.ambientContrast.labelFullAaa"),
              modeAuto: t("shared.ambientContrast.modeAuto"),
              modeStandard: t("shared.ambientContrast.modeStandard"),
              modeFullAaa: t("shared.ambientContrast.modeFullAaa"),
            }}
          />
          <PrintButton label={t("shared.printButton.label")} />
        </div>
      </header>
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
            saveSuccessMessage: t("trips.offlineManifestManager.saveSuccessMessage"),
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
      />

      <section className="mt-7">
        {/*
         * Two key tiles + a `<details>` for the rest below `sm` (task 75,
         * persona 10 Sal): the full six-tile `grid-cols-2` grid used to push
         * the first diver row below the fold on a phone. Boarded/Awaiting are
         * what a captain checks mid-roll-call; Divers/Ready/Blocked/Not
         * boarded are one tap away instead of gone.
         */}
        <div className="grid grid-cols-2 gap-3 sm:hidden">
          {[
            [t("trips.manifest.summaryBoarded"), manifest.summary.boarded],
            [t("trips.manifest.summaryAwaiting"), manifest.summary.awaiting],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded-lg border border-border bg-surface px-4 py-3"
            >
              <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
        <details className="mt-3 sm:hidden">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-primary">
            {t("trips.manifest.moreStatsSummary")}
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {[
              [t("trips.manifest.summaryDivers"), manifest.summary.totalDivers],
              [t("trips.manifest.summaryReady"), manifest.summary.ready],
              [t("trips.manifest.summaryBlocked"), manifest.summary.blocked],
              [t("trips.manifest.summaryNotBoarded"), manifest.summary.notBoarded],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-lg border border-border bg-surface px-4 py-3"
              >
                <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
        </details>
        <div className="hidden gap-3 sm:grid sm:grid-cols-3 lg:grid-cols-6">
          {[
            [t("trips.manifest.summaryDivers"), manifest.summary.totalDivers],
            [t("trips.manifest.summaryReady"), manifest.summary.ready],
            [t("trips.manifest.summaryBlocked"), manifest.summary.blocked],
            [t("trips.manifest.summaryBoarded"), manifest.summary.boarded],
            [t("trips.manifest.summaryNotBoarded"), manifest.summary.notBoarded],
            [t("trips.manifest.summaryAwaiting"), manifest.summary.awaiting],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded-lg border border-border bg-surface px-4 py-3"
            >
              <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
      </section>

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

      <section
        aria-labelledby="roll-call-progress-heading"
        className={
          rollCallComplete
            ? "rise-in sticky top-20 z-10 mt-4 rounded-2xl border border-accent/50 bg-accent/10 p-4 shadow-lg backdrop-blur print:hidden"
            : "sticky top-20 z-10 mt-4 rounded-2xl border border-primary/30 bg-surface/95 p-4 shadow-lg backdrop-blur print:hidden"
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">
              {t("trips.manifest.activeCheckpoint")}
            </p>
            <h2 id="roll-call-progress-heading" className="mt-1 text-lg font-bold">
              {rollCallComplete
                ? t("trips.manifest.rollCallComplete")
                : rollCallCheckpointText(t, checkpoint)}
            </h2>
          </div>
          <p className="text-base font-bold tabular-nums">
            {t("trips.manifest.recordedOfTotal", {
              recorded: manifest.summary.totalDivers - manifest.summary.awaiting,
              total: manifest.summary.totalDivers,
            })}
          </p>
        </div>
        <div
          className="mt-3 h-3 overflow-hidden rounded-full bg-surface-sunken"
          role="progressbar"
          aria-label={t("trips.manifest.progressAriaLabel")}
          aria-valuemin={0}
          aria-valuemax={manifest.summary.totalDivers}
          aria-valuenow={manifest.summary.totalDivers - manifest.summary.awaiting}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{
              width: `${
                manifest.summary.totalDivers === 0
                  ? 0
                  : (
                      (manifest.summary.totalDivers - manifest.summary.awaiting) /
                        manifest.summary.totalDivers
                    ) * 100
              }%`,
            }}
          />
        </div>
        <p className="mt-2 text-sm font-semibold text-muted" aria-live="polite">
          {manifest.summary.awaiting === 0
            ? t("trips.manifest.allAccountedFor")
            : t("trips.manifest.stillToCall", { count: manifest.summary.awaiting })}
        </p>
      </section>

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

      <section className="mt-9">
        <h2 className="text-lg font-semibold">{t("trips.manifest.crewHeading")}</h2>
        {manifest.crew.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t("trips.manifest.noCrew")}</p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {manifest.crew.map((member) => (
              <li
                key={member.fullName}
                className="rounded-full bg-surface-sunken px-3 py-2 text-sm"
              >
                <strong>{member.fullName}</strong> · {member.roles.join(", ")}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="roll-call-list" tabIndex={-1} className="mt-9 outline-none">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              {t("trips.manifest.checkpointRollCallHeading", {
                checkpoint: rollCallCheckpointText(t, checkpoint),
              })}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {t("trips.manifest.checkEachDiverDescription")}
            </p>
          </div>
          <p className="text-sm text-muted">
            {t("trips.manifest.shopTimeLabel", { timezone: shop.timezone })}
          </p>
        </div>
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {manifest.divers.map((diver, index) => {
            const ready = diver.readiness.status === "ready";
            const rc = diver.rollCall;
            const boarded = rc?.state === "boarded";
            // "actioned" == a result staff recorded at *this* checkpoint. An
            // implied not-boarded is carried forward, so it is not yet actioned.
            const explicitNotBoarded = rc?.state === "not_boarded" && !rc.implied;
            const impliedNotBoarded = rc?.state === "not_boarded" && rc.implied === true;
            // Each roll-call state gets its own fill so staff can tell at a glance
            // who has been handled: boarded (green) and not boarded (slate) read as
            // done; awaiting (amber) and blocked (red) still need them.
            const rowClass = boarded
              ? "border-l-4 border-success bg-success/10 px-4 py-5 sm:px-5"
              : explicitNotBoarded
                ? "border-l-4 border-border-strong bg-surface-sunken px-4 py-5 sm:px-5"
                : impliedNotBoarded
                  ? "border-l-4 border-dashed border-border-strong bg-surface-sunken/50 px-4 py-5 sm:px-5"
                  : ready
                    ? "border-l-4 border-warning bg-warning/10 px-4 py-5 ring-1 ring-warning/30 sm:px-5"
                    : "scroll-mt-32 border-l-4 border-danger bg-danger/5 px-4 py-5 sm:px-5";
            // Not a Badge: the "explicitly not boarded" state needs a stronger,
            // higher-contrast fill than "still awaiting" so staff can tell at a
            // glance which rows have been actioned — a distinction the app's
            // five standard Badge tones don't carry.
            const rollCallPillClass = boarded
              ? "rounded-full bg-success/10 px-3 py-1 text-sm font-medium text-success"
              : explicitNotBoarded
                ? "rounded-full bg-foreground/10 px-3 py-1 text-sm font-medium text-foreground"
                : "rounded-full bg-surface-sunken px-3 py-1 text-sm font-medium text-muted";
            return (
              <li
                key={diver.bookingId}
                id={`diver-row-${diver.bookingId}`}
                className={`${rowClass} transition-all duration-300`}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-sunken text-sm font-bold tabular-nums">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <h3 className="text-lg font-semibold">{diver.fullName}</h3>
                      <Badge tone={ready ? "success" : "danger"}>
                        {ready
                          ? t("trips.manifest.readyToBoard")
                          : t("trips.manifest.blockedBadge")}
                      </Badge>
                      {/* Counter check-in and boat roll call are different
                          questions — arrived vs. aboard — and `checked_in`
                          used to have exactly one reader in the app, the
                          check-in page itself (task 149, UX persona lens 17).
                          This is informational only: it never gates roll
                          call. */}
                      {diver.checkedIn ? (
                        <Badge tone="neutral">{t("trips.manifest.checkedInPill")}</Badge>
                      ) : null}
                      {/* The captain reading the boarding list has no other way
                          to know a booked diver is 12 (H-21). Words, not colour
                          alone — this is read in sunlight on a moving boat. */}
                      {diver.age !== null && diver.age !== undefined ? (
                        <Badge tone={diver.minor ? "warning" : "neutral"} tabularNums>
                          {diver.minor
                            ? t("trips.manifest.minorAge", { age: diver.age })
                            : t("trips.manifest.age", { age: diver.age })}
                        </Badge>
                      ) : null}
                      {diver.birthday ? (
                        <Badge tone="primary">
                          <span aria-hidden="true">🎂</span>
                          <span className="sr-only">{t("shared.birthday.label")}</span>
                          <span className="ms-1">{birthdayText(t, diver.birthday)}</span>
                        </Badge>
                      ) : null}
                      <span className={rollCallPillClass}>{rollCallLabel(rc)}</span>
                    </div>
                    {/* The plan for dive two is made here, on the boat, during
                        the surface interval — so the depth advisory has to be
                        here too, not only on the desk-side roster. Warning
                        tone, never a gate (H-08). */}
                    {diver.depthAdvisory?.status === "exceeds" ? (
                      <p className="mt-2 flex gap-2 rounded-lg bg-warning/10 px-3 py-2 text-base text-warning">
                        <span aria-hidden="true">▲</span>
                        <span>{depthWarningText(t, diver.depthAdvisory)}</span>
                      </p>
                    ) : null}
                    <div className="mt-3 grid gap-2 text-base sm:grid-cols-2">
                      <p>
                        <span className="font-bold">
                          {t("trips.manifest.emergencyContactLabel")}
                        </span>
                        <span className="mt-0.5 block text-muted">
                          {diver.emergencyContactName && diver.emergencyContactPhone
                            ? `${diver.emergencyContactName} · ${diver.emergencyContactPhone}`
                            : t("trips.manifest.notOnFile")}
                        </span>
                      </p>
                      <p>
                        <span className="font-bold">{t("trips.manifest.rentalFitLabel")}</span>
                        <span className="mt-0.5 block text-muted">
                          {rentalFitLineText(t, locale, diver.rentalFit)}
                          {diver.nitroxRequested ? t("trips.manifest.nitroxRequestedSuffix") : ""}
                        </span>
                      </p>
                      {diver.medicalWaiver ? (
                        <p>
                          <span className="font-bold">
                            {diver.medicalWaiver.source === "paper"
                              ? t("trips.manifest.medicalReviewedPaper")
                              : diver.medicalWaiver.source === "imported"
                                ? t("trips.manifest.medicalClearanceImported")
                                : t("trips.manifest.medicalWaiverSigned")}
                          </span>
                          <span className="mt-0.5 block text-muted">
                            {formatShortDate(diver.medicalWaiver.at, locale, shop.timezone)}
                          </span>
                        </p>
                      ) : null}
                    </div>
                    {!ready ? (
                      <>
                        <ul className="mt-3 flex flex-col gap-1 text-base text-danger">
                          {diver.readiness.blockers.map((blocker) => (
                            <li key={blocker.code}>• {readinessBlockerText(t, blocker)}</li>
                          ))}
                        </ul>
                        {/* At departure this unblocks boarding; after a dive the
                            diver is aboard, so it's a shore follow-up on their record. */}
                        <Link
                          href={`/shop/${shopSlug}/trips/${tripId}/guests#booking-${diver.bookingId}`}
                          className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline print:hidden"
                        >
                          {t("trips.manifest.resolveBlockersLink")}
                        </Link>
                      </>
                    ) : null}
                    <details className="mt-3 max-w-xl rounded-xl border border-border/70 bg-surface-sunken/50 p-3 print:hidden">
                      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold text-primary">
                        {t("trips.manifest.addNoteSummary")}
                      </summary>
                      <RollCallNote
                        bookingId={diver.bookingId}
                        checkpoint={checkpoint}
                        formId={`not-boarded-${diver.bookingId}`}
                        initialNote={rc && !rc.implied ? (rc.note ?? "") : ""}
                        canAutoSave={!!rc && !rc.implied}
                        saveNote={saveRollCallNoteAction}
                        copy={{
                          optionalNote: t("shared.rollCallNote.optionalNote"),
                          message: {
                            manualOnly: t("shared.rollCallNote.message.manualOnly"),
                            saving: t("shared.rollCallNote.message.saving"),
                            saved: t("shared.rollCallNote.message.saved"),
                            queued: t("shared.rollCallNote.message.queued"),
                            error: t("shared.rollCallNote.message.error"),
                            idle: t("shared.rollCallNote.message.idle"),
                          },
                          statusPill: {
                            saving: t("shared.rollCallNote.statusPill.saving"),
                            saved: t("shared.rollCallNote.statusPill.saved"),
                            queued: t("shared.rollCallNote.statusPill.queued"),
                            error: t("shared.rollCallNote.statusPill.error"),
                          },
                          notePlaceholder: t("shared.rollCallNote.notePlaceholder"),
                        }}
                      />
                    </details>
                    {rc && !rc.implied ? (
                      <p className="mt-3 text-sm text-muted">
                        {rc.note
                          ? t("trips.manifest.rollCallRecordedByWithNote", {
                              label: rollCallLabel(rc),
                              date: formatDateTimeTz(rc.occurredAt, locale, shop.timezone),
                              name: rc.recordedByName,
                              note: rc.note,
                            })
                          : t("trips.manifest.rollCallRecordedByPlain", {
                              label: rollCallLabel(rc),
                              date: formatDateTimeTz(rc.occurredAt, locale, shop.timezone),
                              name: rc.recordedByName,
                            })}
                      </p>
                    ) : impliedNotBoarded ? (
                      // Carried-forward not-boarded only happens after a dive, where
                      // boarding is a head count — so it never depends on readiness.
                      <p className="mt-3 text-sm text-muted">
                        {t("trips.manifest.carriedForward")}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex w-full shrink-0 flex-col gap-2 print:hidden sm:w-56">
                    {ready || !isDeparture ? (
                      <RollCallButton
                        // Forces a remount — and a fresh `useActionState`
                        // `result` — on every checkpoint switch (see the
                        // component's own doc comment); this route/key is
                        // otherwise identical across checkpoints.
                        key={`board-${checkpoint}`}
                        action={rollCallAction}
                        bookingId={diver.bookingId}
                        status={boarded ? "cleared" : "boarded"}
                        label={
                          boarded
                            ? t("trips.manifest.boardedCheck")
                            : t("trips.manifest.markBoarded")
                        }
                        pendingLabel={
                          boarded ? t("trips.manifest.undoing") : t("trips.manifest.boarding")
                        }
                        className={`${BOAT_TARGET_CLASS} ${
                          boarded
                            ? "border border-success bg-success/15 text-success"
                            : "bg-primary text-primary-foreground hover:bg-primary-hover"
                        }`}
                        copy={rollCallButtonCopy(diver.bookingId)}
                      />
                    ) : null}
                    <RollCallButton
                      // Same remount-on-checkpoint reasoning as the board
                      // button above.
                      key={`not-boarded-${checkpoint}`}
                      action={rollCallAction}
                      bookingId={diver.bookingId}
                      status={explicitNotBoarded ? "cleared" : "not_boarded"}
                      label={
                        explicitNotBoarded
                          ? t("trips.manifest.notBoardedCheck")
                          : t("trips.manifest.markNotBoarded")
                      }
                      pendingLabel={t("trips.manifest.saving")}
                      formId={`not-boarded-${diver.bookingId}`}
                      className={`${BOAT_TARGET_CLASS} ${
                        explicitNotBoarded
                          ? "border border-border-strong bg-surface-sunken"
                          : "border border-border hover:bg-surface-sunken"
                      }`}
                      copy={rollCallButtonCopy(diver.bookingId)}
                    />
                    {rc && !rc.implied ? (
                      <p className="text-xs text-muted">{t("trips.manifest.tapToUndo")}</p>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

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
