import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import {
  RollCallButton,
  type RollCallResult,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton";
import { AmbientContrastControl, AmbientGlareDetector } from "@/components/AmbientGlareDetector";
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
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { WaterLocker, WaterLockerToggle } from "@/components/WaterLocker";
import { getDb } from "@/db/client";
import {
  getTripManifests,
  recordCrewAttestation,
  recordCrewRollCall,
  recordRollCall,
  updateLatestRollCallNote,
} from "@/db/manifests";
import { getShopById } from "@/db/shops";
import { birthdayText } from "@/i18n/birthday-labels";
import { depthWarningText } from "@/i18n/depth-labels";
import { rollCallCheckpointText, rollCallLabelText } from "@/i18n/manifest-labels";
import {
  readinessBlockerText,
  readinessStatusText,
  readinessStatusTone,
} from "@/i18n/readiness-labels";
import { rentalFitLineText } from "@/i18n/rental-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { trackEvent } from "@/lib/analytics";
import { formatDateTimeTz, formatShortDate, formatTimeRangeTz } from "@/lib/format";
import {
  isNotBackAboard,
  isRollCallCheckpoint,
  type RollCallCheckpoint,
  rollCallCheckpoints,
  rollCallLabel,
} from "@/lib/manifests";
import { serializeManifests } from "@/lib/offline-manifests";
import { requireStaffSession } from "@/lib/session";

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

// The count is the only number staff supply; the denominator is read server-side
// from the trip's assignments inside `recordCrewAttestation`. `99` mirrors the
// domain layer's own ceiling — this is a duplicate guard, not the authority.
const crewAttestationSchema = z.object({
  crewAboard: z.coerce.number().int().min(0).max(99),
  note: z.string().trim().max(300).optional(),
});

// The crew subject is a `people.id`, never a booking. The server re-proves the
// person is assigned to *this* trip before writing anything (`recordCrewRollCall`).
const crewRollCallSchema = z.object({
  personId: z.string().uuid(),
  status: z.enum(["boarded", "not_boarded", "cleared"]),
});

export default async function TripManifestPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{ checkpoint?: string; crewError?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, id: tripId } = await params;
  const { checkpoint: requestedCheckpoint, crewError } = await searchParams;
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
  // One definition, shared with the offline copy: divers *and* crew (DOM-H1,
  // ADR 20260802-crew-roll-call-attestation). This used to be written inline
  // here and again in OfflineManifestView as `totalDivers > 0 && awaiting === 0`,
  // which counted booked divers only — so a checkpoint could read complete with
  // a divemaster still in the water.
  const completeness = manifest.completeness;
  const rollCallComplete = completeness.complete;
  const crewAssigned = manifest.crew.length;
  const crewAttestation = manifest.crewAttestation;
  // Who among the named crew is still unaccounted for at this checkpoint, and
  // how many bodies the count actually has to cover. Read off the completeness
  // verdict itself rather than recomputed, so this page and the number that
  // closes the checkpoint can never disagree.
  const crewCounts = completeness.crewCounts;
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

  /**
   * Record one crew member's own result at this checkpoint (DOM-H1, ADR
   * 20260803-per-person-crew-roll-call). Same control, same refusal handling,
   * and the same append-only write a diver gets — the subject is a `people.id`
   * instead of a booking, and readiness never applies to crew.
   */
  async function crewRollCallAction(
    _prev: RollCallResult,
    formData: FormData,
  ): Promise<RollCallResult> {
    "use server";
    const staff = await requireStaffSession();
    const parsed = crewRollCallSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, reason: "error" };
    try {
      const outcome = await recordCrewRollCall(await getDb(), {
        shopId: staff.user.shopId,
        tripId,
        personId: parsed.data.personId,
        recordedByPersonId: staff.user.personId,
        status: parsed.data.status,
        checkpoint,
      });
      // Every refusal reads the same on the boat: the tap did not stick. The
      // distinctions (`crew_not_assigned`, `trip_unavailable`) are server-side
      // codes, not something to explain to someone with wet hands.
      if (!outcome.ok) return { ok: false, reason: "error" };
    } catch {
      return { ok: false, reason: "error" };
    }
    revalidatePath(back.split("?")[0]);
    return { ok: true };
  }

  /**
   * Record how many crew are aboard at this checkpoint. A plain form post, not
   * an optimistic client control: this is the number that closes a head count,
   * so it settles only once the server has written the row.
   */
  async function attestCrewAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = crewAttestationSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      redirect(`${back}&crewError=1`);
    }
    const outcome = await recordCrewAttestation(await getDb(), {
      shopId: staff.user.shopId,
      tripId,
      attestedByPersonId: staff.user.personId,
      crewAboard: parsed.data.crewAboard,
      checkpoint,
      note: parsed.data.note,
    });
    if (!outcome.ok) redirect(`${back}&crewError=1`);
    revalidatePath(back.split("?")[0]);
    redirect(back);
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
          <p className="mt-3 flex flex-wrap gap-2 print:hidden">
            <span className="glare-mode-indicator rounded-full bg-foreground/10 px-3 py-1 text-sm font-medium text-foreground ring-1 ring-inset ring-foreground/20">
              {t("trips.manifest.glareModeActive")}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-4 print:hidden">
          <AmbientContrastControl
            copy={{
              contrastLabel: t("shared.ambientContrast.contrastLabel"),
              labelAuto: t("shared.ambientContrast.labelAuto"),
              labelStandard: t("shared.ambientContrast.labelStandard"),
              labelFullAaa: t("shared.ambientContrast.labelFullAaa"),
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
              [notBoardedTileLabel, notBoardedTileValue],
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
            [notBoardedTileLabel, notBoardedTileValue],
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
        {/* The one line that says whether this checkpoint is closed. It used to
            go quiet at `awaiting === 0` — every diver counted, nothing said
            about the crew. Now it names what is still open. */}
        <p
          className={
            completeness.reason === "divers_not_back_aboard" ||
            completeness.reason === "crew_not_back_aboard"
              ? "mt-2 text-sm font-bold text-danger"
              : "mt-2 text-sm font-semibold text-muted"
          }
          aria-live="polite"
        >
          {completeness.reason === "divers_not_back_aboard"
            ? t("trips.manifest.notBackAboardOpen", { count: manifest.summary.notBackAboard })
            : completeness.reason === "divers_awaiting"
              ? t("trips.manifest.stillToCall", { count: manifest.summary.awaiting })
              : completeness.reason === "crew_not_back_aboard"
                ? t("trips.manifest.crewNotBackAboard", { count: crewCounts.crewNotBackAboard })
                : completeness.reason === "crew_not_attested"
                  ? t("trips.manifest.crewNotAttestedYet")
                  : completeness.reason === "crew_short" && crewAttestation
                    ? t("trips.manifest.crewShort", {
                        aboard: crewAttestation.crewAboard,
                        // Everyone assigned *minus* anyone already recorded as
                        // ashore — the number the count actually has to cover.
                        assigned: crewCounts.crewExpectedAboard,
                      })
                    : completeness.reason === "crew_awaiting"
                      ? t("trips.manifest.crewAwaiting", { count: crewCounts.crewAwaiting })
                      : t("trips.manifest.allAccountedFor")}
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
        {crewAssigned === 0 ? (
          <p className="mt-3 text-sm text-muted">{t("trips.manifest.noCrew")}</p>
        ) : (
          <>
            <p className="mt-1 max-w-prose text-sm text-muted">
              {t("trips.manifest.crewRollCallDescription")}
            </p>
            {/* Per-person crew roll call (DOM-H1). A count says how many; this
                says *who*, which is the only way the boat learns that the third
                body aboard is the deckhand and not the divemaster who has not
                surfaced. Same control, same append-only write, same undo as a
                diver's — the subject is a person, not a booking. */}
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
              {manifest.crew.map((member) => {
                const rc = member.rollCall;
                const aboard = rc?.state === "boarded";
                const recordedNotAboard = rc?.state === "not_boarded" && rc.implied !== true;
                const notBackAboard = isNotBackAboard(checkpoint, rc);
                return (
                  <li
                    key={member.id}
                    className={
                      notBackAboard
                        ? "border-l-4 border-danger bg-danger/10 px-4 py-4 ring-1 ring-danger/40"
                        : aboard
                          ? "border-l-4 border-success bg-success/10 px-4 py-4"
                          : rc
                            ? "border-l-4 border-border-strong bg-surface-sunken px-4 py-4"
                            : "border-l-4 border-warning bg-warning/10 px-4 py-4 ring-1 ring-warning/30"
                    }
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2">
                          <strong className="text-base">{member.fullName}</strong>
                          <span className="text-sm text-muted">{member.roles.join(", ")}</span>
                          <span
                            className={
                              notBackAboard
                                ? "rounded-full bg-danger/15 px-3 py-1 text-sm font-bold text-danger"
                                : aboard
                                  ? "rounded-full bg-success/10 px-3 py-1 text-sm font-medium text-success"
                                  : recordedNotAboard
                                    ? "rounded-full bg-foreground/10 px-3 py-1 text-sm font-medium text-foreground"
                                    : "rounded-full bg-surface-sunken px-3 py-1 text-sm font-medium text-muted"
                            }
                          >
                            {rollCallLabelText(t, rollCallLabel(checkpoint, rc))}
                          </span>
                        </p>
                        {rc && !rc.implied ? (
                          <p className="mt-2 text-sm text-muted">
                            {t("trips.manifest.crewRollCallRecordedBy", {
                              label: rollCallLabelText(t, rollCallLabel(checkpoint, rc)),
                              date: formatDateTimeTz(rc.occurredAt, locale, shop.timezone),
                              name: rc.recordedByName,
                            })}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex w-full shrink-0 flex-col gap-2 print:hidden sm:w-56">
                        <RollCallButton
                          // Same remount-on-checkpoint contract the diver
                          // buttons follow (see the component's doc comment):
                          // without it a refusal from one checkpoint can
                          // survive into another and misattribute.
                          key={`crew-aboard-${checkpoint}`}
                          action={crewRollCallAction}
                          subject={{ field: "personId", id: member.id }}
                          status={aboard ? "cleared" : "boarded"}
                          label={
                            aboard
                              ? t("trips.manifest.crewAboardCheck")
                              : t("trips.manifest.crewMarkAboard")
                          }
                          pendingLabel={t("trips.manifest.saving")}
                          className={`${BOAT_TARGET_CLASS} ${
                            aboard
                              ? "border border-success bg-success/15 text-success"
                              : "bg-primary text-primary-foreground hover:bg-primary-hover"
                          }`}
                          copy={crewRollCallButtonCopy}
                        />
                        <RollCallButton
                          key={`crew-not-aboard-${checkpoint}`}
                          action={crewRollCallAction}
                          subject={{ field: "personId", id: member.id }}
                          status={recordedNotAboard ? "cleared" : "not_boarded"}
                          // After a dive this control means "did not come back"
                          // and never settles into a green-checked done state —
                          // the same DOM-H3 rule the diver buttons follow.
                          label={
                            recordedNotAboard
                              ? isDeparture
                                ? t("trips.manifest.crewNotAboardCheck")
                                : t("trips.manifest.crewNotBackAboardActive")
                              : isDeparture
                                ? t("trips.manifest.crewMarkNotAboard")
                                : t("trips.manifest.crewMarkNotBackAboard")
                          }
                          pendingLabel={t("trips.manifest.saving")}
                          className={`${BOAT_TARGET_CLASS} ${
                            notBackAboard
                              ? "border border-danger bg-danger/15 text-danger"
                              : recordedNotAboard
                                ? "border border-border-strong bg-surface-sunken"
                                : "border border-border hover:bg-surface-sunken"
                          }`}
                          copy={crewRollCallButtonCopy}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {/*
         * The crew half of the head count (DOM-H1). Crew hold no booking, so
         * they cannot be roll-call subjects — this is an attested count, not a
         * per-person call, and the checkpoint does not read complete without
         * it. A trip with zero assigned crew is not exempt: "0 of 0" is still
         * something a named human says, because an empty assignment list is a
         * scheduling gap, not evidence that nobody else was aboard.
         */}
        <div
          className={
            completeness.crewAccountedFor
              ? "mt-4 rounded-2xl border border-success/40 bg-success/10 p-4 print:hidden"
              : "mt-4 rounded-2xl border border-warning/50 bg-warning/10 p-4 print:hidden"
          }
        >
          <h3 className="text-base font-bold">
            {t("trips.manifest.crewAboardHeading", {
              checkpoint: rollCallCheckpointText(t, checkpoint),
            })}
          </h3>
          <p className="mt-1 max-w-prose text-sm text-muted">
            {t("trips.manifest.crewAboardDescription")}
          </p>
          <p className="mt-3 text-base font-semibold">
            {crewAttestation
              ? t("trips.manifest.crewAttestedSummary", {
                  aboard: crewAttestation.crewAboard,
                  assigned: crewAttestation.crewAssigned,
                  name: crewAttestation.attestedByName,
                  date: formatDateTimeTz(crewAttestation.occurredAt, locale, shop.timezone),
                })
              : t("trips.manifest.crewAttestationMissing")}
          </p>
          {crewAttestation?.note ? (
            <p className="mt-1 text-sm text-muted">
              {t("trips.manifest.crewAttestedNote", { note: crewAttestation.note })}
            </p>
          ) : null}
          {/* The stored denominator is evidence of what was true then;
              completeness compares against the assignment list *now*, so
              adding a crew member re-opens the checkpoint rather than riding
              on a stale count. Say so rather than silently reverting. */}
          {crewAttestation && crewAttestation.crewAssigned !== crewAssigned ? (
            <p className="mt-1 text-sm font-semibold text-warning">
              {t("trips.manifest.crewAttestationStaleAssigned", { assigned: crewAssigned })}
            </p>
          ) : null}
          {crewError ? (
            <p className="mt-2 text-sm font-semibold text-danger" role="status">
              {t("trips.manifest.crewAttestError")}
            </p>
          ) : null}
          <FieldGrid as="form" action={attestCrewAction} columns={2} className="mt-4">
            <Field
              label={t("trips.manifest.crewAboardLabel")}
              // The hint names the number that closes the checkpoint. When
              // somebody is recorded ashore that is *not* the assignment count,
              // and asking for the assignment count would be asking the crew to
              // type a body that is not on the boat (review 20260803, D2).
              hint={
                crewCounts.crewAshore > 0
                  ? t("trips.manifest.crewAboardHintExpected", {
                      expected: crewCounts.crewExpectedAboard,
                      ashore: crewCounts.crewAshore,
                    })
                  : t("trips.manifest.crewAboardHint", { assigned: crewAssigned })
              }
              description={t("trips.manifest.crewAboardFieldDescription")}
            >
              <input
                name="crewAboard"
                type="number"
                inputMode="numeric"
                min={0}
                max={99}
                step={1}
                required
                // Empty until someone has counted, never pre-filled with the
                // assigned total: a head count whose default answer closes the
                // checkpoint is a rubber stamp, which is the failure mode this
                // whole control exists to remove. A re-count starts from the
                // last attested number so a correction is one edit.
                defaultValue={crewAttestation?.crewAboard ?? ""}
                // Just `controlClass` — its own `min-h-11` is the 44px touch
                // floor, and a second `min-h-*` appended here would resolve by
                // stylesheet order rather than class order (see the note in
                // components/ui/button.ts). Same pattern the offline roll-call
                // note input uses on this surface.
                className={`${controlClass} text-lg tabular-nums`}
              />
            </Field>
            <Field
              label={t("trips.manifest.crewAttestNoteLabel")}
              hint={t("trips.manifest.crewAttestNoteHint")}
            >
              <input
                name="note"
                maxLength={300}
                placeholder={t("trips.manifest.crewAttestNotePlaceholder")}
                className={controlClass}
              />
            </Field>
            <FieldActions>
              <button type="submit" className={buttonClass({ size: "boat" })}>
                {t("trips.manifest.crewAttestSubmit")}
              </button>
            </FieldActions>
          </FieldGrid>
        </div>
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
            {/* The control that isn't "Boarded" means something different once
                the boat is out, and the crew tapping it in the dark should be
                told which one they are looking at (DOM-H3). */}
            {isDeparture ? null : (
              <p className="mt-1 max-w-prose text-sm font-semibold text-warning">
                {t("trips.manifest.notBackAboardDescription")}
              </p>
            )}
          </div>
          <p className="text-sm text-muted">
            {t("trips.manifest.shopTimeLabel", { timezone: shop.timezone })}
          </p>
        </div>
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {manifest.divers.map((diver, index) => {
            const diverStatus = diver.readiness.status;
            const ready = diverStatus === "ready";
            const rc = diver.rollCall;
            const boarded = rc?.state === "boarded";
            // A result staff recorded at *this* checkpoint, either way round. An
            // implied not-boarded is carried forward from the dock, so it is not
            // one — nothing here is undoable and no note attaches to it.
            const recordedNotBoarded = rc?.state === "not_boarded" && rc.implied !== true;
            // ...and after a dive that same record means "did not return to the
            // boat" (DOM-H3). It is the missing-diver row, not a settled one.
            const notBackAboard = isNotBackAboard(checkpoint, rc);
            const explicitNotBoarded = recordedNotBoarded && !notBackAboard;
            const impliedNotBoarded = rc?.state === "not_boarded" && rc.implied === true;
            // Each roll-call state gets its own fill so staff can tell at a glance
            // who has been handled: boarded (green) and not boarded (slate) read as
            // done; awaiting (amber), not back aboard, and blocked (red) still need
            // them. Not back aboard is the loudest state on the page on purpose —
            // it used to render in the same "handled" slate as a diver left ashore.
            const rowClass = notBackAboard
              ? "scroll-mt-32 border-l-4 border-danger bg-danger/10 px-4 py-5 ring-1 ring-danger/40 sm:px-5"
              : boarded
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
            const rollCallPillClass = notBackAboard
              ? "rounded-full bg-danger/15 px-3 py-1 text-sm font-bold text-danger"
              : boarded
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
                      {/* The one readiness vocabulary (src/i18n/readiness-labels.ts).
                          The manifest is where "Blocked" was already the word,
                          which is why it is the word everywhere now. */}
                      <Badge tone={readinessStatusTone(diverStatus)}>
                        {readinessStatusText(t, diverStatus)}
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
                      <span className={rollCallPillClass}>
                        {rollCallLabelText(t, rollCallLabel(checkpoint, rc))}
                      </span>
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
                              label: rollCallLabelText(t, rollCallLabel(checkpoint, rc)),
                              date: formatDateTimeTz(rc.occurredAt, locale, shop.timezone),
                              name: rc.recordedByName,
                              note: rc.note,
                            })
                          : t("trips.manifest.rollCallRecordedByPlain", {
                              label: rollCallLabelText(t, rollCallLabel(checkpoint, rc)),
                              date: formatDateTimeTz(rc.occurredAt, locale, shop.timezone),
                              name: rc.recordedByName,
                            })}
                      </p>
                    ) : impliedNotBoarded ? (
                      // The only thing that carries forward is a departure result:
                      // this diver never left the dock (DOM-H3). Boarding after a
                      // dive is a head count, so it never depends on readiness.
                      <p className="mt-3 text-sm text-muted">
                        {t("trips.manifest.carriedForwardFromDock")}
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
                        subject={{ field: "bookingId", id: diver.bookingId }}
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
                      subject={{ field: "bookingId", id: diver.bookingId }}
                      status={recordedNotBoarded ? "cleared" : "not_boarded"}
                      // The worst string in the change was a green-checked "Not
                      // boarded ✓" beside a diver who had not come back from dive
                      // one. After a dive this control is "not back aboard" and
                      // its recorded state never carries a done-check (DOM-H3).
                      label={
                        recordedNotBoarded
                          ? isDeparture
                            ? t("trips.manifest.notBoardedCheck")
                            : t("trips.manifest.notBackAboardActive")
                          : isDeparture
                            ? t("trips.manifest.markNotBoarded")
                            : t("trips.manifest.markNotBackAboard")
                      }
                      pendingLabel={t("trips.manifest.saving")}
                      formId={`not-boarded-${diver.bookingId}`}
                      className={`${BOAT_TARGET_CLASS} ${
                        notBackAboard
                          ? "border border-danger bg-danger/15 text-danger"
                          : explicitNotBoarded
                            ? "border border-border-strong bg-surface-sunken"
                            : "border border-border hover:bg-surface-sunken"
                      }`}
                      copy={rollCallButtonCopy(diver.bookingId)}
                    />
                    {rc && !rc.implied ? (
                      // The undo hint names the control it means. A not-back-aboard
                      // result deliberately carries no done-check, so the generic
                      // "tap the ✓ status again" would point at nothing on screen.
                      <p className="text-xs text-muted">
                        {notBackAboard
                          ? t("trips.manifest.tapToUndoNotBackAboard")
                          : t("trips.manifest.tapToUndo")}
                      </p>
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
