import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import {
  RollCallButton,
  type RollCallResult,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton";
import { MilestoneHaptics } from "@/components/MilestoneHaptics";
import { MissingDiversGrid, type MissingDiversGridCopy } from "@/components/MissingDiversGrid";
import {
  OfflineManifestManager,
  type OfflineManifestManagerCopy,
} from "@/components/OfflineManifestManager";
import { PrintButton } from "@/components/PrintButton";
import { RollCallNote } from "@/components/RollCallNote";
import { ShopNotice } from "@/components/ShopPageHeader";
import { SkipLink } from "@/components/SkipLink";
import { SubSurfaceRipple } from "@/components/SubSurfaceRipple";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/form";
import { WaterLocker, WaterLockerToggle } from "@/components/WaterLocker";
import { canPersonExportIncidentRecord } from "@/db/authz";
import {
  addBuddyTeamMember,
  type BuddyTeamMemberInput,
  dissolveBuddyTeam,
  formBuddyTeam,
  listTripBuddyTeams,
  removeBuddyTeamMember,
} from "@/db/buddy-pairs";
import { getDb } from "@/db/client";
import {
  getTripManifests,
  recordCrewRollCall,
  recordRollCall,
  updateLatestRollCallNote,
} from "@/db/manifests";
import { getShopById } from "@/db/shops";
import { birthdayText } from "@/i18n/birthday-labels";
import { buddyAlertText } from "@/i18n/buddy-labels";
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
  type BuddyAlert,
  isNotBackAboard,
  isRollCallCheckpoint,
  type ManifestBuddyTeam,
  type RollCallCheckpoint,
  rollCallCheckpoints,
  rollCallLabel,
  splitBuddyTeamIds,
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

/**
 * One fill per roll-call state, shared by the diver rows and the crew rows so
 * the two lists can never disagree about what a colour means.
 *
 * The two *recorded* outcomes have to be told apart across a wet deck in
 * sunlight, which is why they are opposite hues rather than two washes of the
 * same one: aboard is green, left ashore is amber. They used to be `success/10`
 * and a plain slate `surface-sunken`, two pale neutrals that read as the same
 * card at arm's length. Awaiting takes the slate instead — nothing has been
 * said about that person yet, which is the quietest state on the page, not a
 * warning. Colour never carries this alone: every row also states its status in
 * words on the button beside it.
 */
const ROLL_CALL_ROW_TONE = {
  /** A stated "did not come back" — the loudest thing on the page. */
  notBackAboard: "border-danger bg-danger/15 ring-1 ring-danger/40",
  boarded: "border-success bg-success/20",
  notBoarded: "border-warning bg-warning/25 ring-1 ring-warning/40",
  /** Carried forward from the dock rather than recorded here — same hue, quieter. */
  notBoardedImplied: "border-dashed border-warning/60 bg-warning/10",
  awaiting: "border-border-strong bg-surface-sunken",
  /** Awaiting *and* blocked: readiness is the thing to fix before boarding. */
  blocked: "border-danger bg-danger/5",
} as const;

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

// The crew subject is a `people.id`, never a booking. The server re-proves the
// person is assigned to *this* trip before writing anything (`recordCrewRollCall`).
const crewRollCallSchema = z.object({
  personId: z.string().uuid(),
  status: z.enum(["boarded", "not_boarded", "cleared"]),
});

/**
 * A team member as the form carries one: `diver:<bookingId>` or
 * `crew:<personId>`. One token per checkbox and per select option, so a form
 * that mixes divers and crew stays a flat list of values rather than two
 * parallel fields a caller could pair up wrongly.
 *
 * Every rule about a member (same trip, active seat, assigned crew, not
 * already teamed) is re-proved server-side in `src/db/buddy-pairs.ts`; this
 * only checks the shape.
 */
const memberTokenSchema = z.string().regex(/^(?:diver|crew):[0-9a-fA-F-]{36}$/, "member token");

function parseMemberToken(token: string): BuddyTeamMemberInput {
  const [kind, id] = token.split(":");
  return kind === "diver"
    ? { kind: "diver", bookingId: id as string }
    : { kind: "crew", personId: id as string };
}

const formTeamSchema = z.object({ members: z.array(memberTokenSchema).min(2).max(40) });
const teamMemberSchema = z.object({
  teamId: z.string().uuid(),
  member: memberTokenSchema,
});
const teamSchema = z.object({ teamId: z.string().uuid() });

/**
 * The one place a team refusal turns into a query param. Two refusals a
 * staffer can act on get their own words, plus the size rule; the rest
 * (tenancy, cancelled trip, non-roster booking, a team that vanished under
 * them) collapse into one — they mean the form was stale or forged, not that a
 * different pick would have worked.
 *
 * **Module scope, deliberately.** A `"use server"` closure serializes the scope
 * it captures, so a helper declared beside the actions inside the page
 * component is a function in that scope — and every action that calls it fails
 * with "Functions cannot be passed directly to Client Components" the moment a
 * form posts. It renders fine on first load and dies on the round trip, which
 * is about the least helpful way a mistake can present itself.
 */
function buddyErrorCode(reason: string): string {
  if (reason === "duplicate_member") return "duplicate";
  if (reason === "already_teamed") return "teamed";
  if (reason === "too_few_members") return "few";
  return "generic";
}

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
  const crewAssigned = manifest.crew.length;
  // Who among the named crew is still unaccounted for at this checkpoint. Read
  // off the completeness verdict itself rather than recomputed, so this page
  // and the rule that closes the checkpoint can never disagree.
  const crewCounts = completeness.crewCounts;
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
   * Form a buddy team from two or more people (ADR 20260804-buddy-teams). A
   * plain form post rather than an optimistic control: pairing is a deliberate
   * desk/dock act, not a mid-roll-call tap, so it settles only once the server
   * has written every member row and the trail entry behind them. Every
   * refusal re-lands on this checkpoint with a worded reason.
   */
  async function formBuddyTeamAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = formTeamSchema.safeParse({ members: formData.getAll("members") });
    // Fewer than two ticked is the one shape error a staffer can act on, so it
    // gets the size wording rather than the generic one.
    if (!parsed.success) redirect(`${back}&buddyError=few`);
    const outcome = await formBuddyTeam(await getDb(), {
      shopId: staff.user.shopId,
      tripId,
      members: parsed.data.members.map(parseMemberToken),
      recordedByPersonId: staff.user.personId,
    });
    if (!outcome.ok) redirect(`${back}&buddyError=${buddyErrorCode(outcome.reason)}`);
    revalidatePath(back.split("?")[0]);
    redirect(back);
  }

  /** Add one more person to a team that already stands. */
  async function addBuddyTeamMemberAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = teamMemberSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`${back}&buddyError=generic`);
    const outcome = await addBuddyTeamMember(await getDb(), {
      shopId: staff.user.shopId,
      tripId,
      teamId: parsed.data.teamId,
      member: parseMemberToken(parsed.data.member),
      recordedByPersonId: staff.user.personId,
    });
    if (!outcome.ok) redirect(`${back}&buddyError=${buddyErrorCode(outcome.reason)}`);
    revalidatePath(back.split("?")[0]);
    redirect(back);
  }

  /**
   * Drop one person from a team that keeps standing. The server refuses a
   * removal that would leave fewer than two, which is why this control only
   * appears on teams of three or more — dissolving is its own act, with its
   * own entry on the trail.
   */
  async function removeBuddyTeamMemberAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = teamMemberSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`${back}&buddyError=generic`);
    const outcome = await removeBuddyTeamMember(await getDb(), {
      shopId: staff.user.shopId,
      tripId,
      teamId: parsed.data.teamId,
      member: parseMemberToken(parsed.data.member),
      recordedByPersonId: staff.user.personId,
    });
    if (!outcome.ok) redirect(`${back}&buddyError=${buddyErrorCode(outcome.reason)}`);
    revalidatePath(back.split("?")[0]);
    redirect(back);
  }

  /** Dissolve a team — the explicit act re-forming always goes through. */
  async function dissolveBuddyTeamAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = teamSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`${back}&buddyError=generic`);
    const outcome = await dissolveBuddyTeam(await getDb(), {
      shopId: staff.user.shopId,
      tripId,
      teamId: parsed.data.teamId,
      recordedByPersonId: staff.user.personId,
    });
    if (!outcome.ok) redirect(`${back}&buddyError=generic`);
    revalidatePath(back.split("?")[0]);
    redirect(back);
  }

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
  const teamNameList = new Intl.ListFormat(locale, { type: "conjunction" });
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
                : completeness.reason === "crew_none_assigned"
                  ? t("trips.manifest.crewNoneAssignedYet")
                  : completeness.reason === "crew_awaiting"
                    ? t("trips.manifest.crewAwaiting", { count: crewCounts.crewAwaiting })
                    : t("trips.manifest.allAccountedFor")}
        </p>
        {/* Buddy teams that came back split — someone aboard, someone not
            (ADR 20260804-buddy-teams). Its own line, never folded into the
            completeness reason above: it informs the deck and blocks
            nothing, and the checkpoint's own open/closed verdict must not
            appear to depend on it. */}
        {separatedTeams > 0 ? (
          <p className="mt-1 text-sm font-bold text-danger" role="status">
            {t("trips.manifest.buddySeparatedLine", { count: separatedTeams })}
          </p>
        ) : null}
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
          // An empty crew list holds the checkpoint open (`crew_none_assigned`),
          // so the one thing to say here is how to close it. This replaces the
          // typed "how many crew are aboard" attestation the manifest used to
          // ask for — a number that named nobody, on a page whose whole point is
          // naming people (ADR 20260804-crew-roll-call-is-per-person).
          <div className="mt-3 rounded-2xl border border-warning/50 bg-warning/10 p-4 print:hidden">
            <p className="max-w-prose text-sm">{t("trips.manifest.noCrew")}</p>
            <Link
              href={`/shop/${shopSlug}/trips/${tripId}#crew`}
              className={buttonClass({ size: "boat", className: "mt-3" })}
            >
              {t("trips.manifest.addCrewToTrip")}
            </Link>
          </div>
        ) : (
          <>
            <p className="mt-1 max-w-prose text-sm text-muted">
              {t("trips.manifest.crewRollCallDescription")}
            </p>
            {/* Per-person crew roll call — the whole crew half of the head
                count since ADR 20260804-crew-roll-call-is-per-person (DOM-H1).
                It says *who*, which is the only way the boat learns that the
                third body aboard is the deckhand and not the divemaster who
                has not surfaced; the typed "how many crew are aboard" count
                that used to sit below this list named nobody. Same control,
                same append-only write, same undo as a diver's — the subject is
                a person, not a booking. */}
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
              {manifest.crew.map((member) => {
                const rc = member.rollCall;
                const aboard = rc?.state === "boarded";
                const recordedNotAboard = rc?.state === "not_boarded" && rc.implied !== true;
                const notBackAboard = isNotBackAboard(checkpoint, rc);
                // Same rule the diver rows follow: the two buttons below
                // already state this person's status, so the pill only earns
                // its place while nobody has said anything at this checkpoint.
                const recordedHere = !!rc && !rc.implied;
                return (
                  <li
                    key={member.id}
                    className={`border-l-4 px-4 py-4 ${
                      notBackAboard
                        ? ROLL_CALL_ROW_TONE.notBackAboard
                        : aboard
                          ? ROLL_CALL_ROW_TONE.boarded
                          : recordedNotAboard
                            ? ROLL_CALL_ROW_TONE.notBoarded
                            : rc
                              ? ROLL_CALL_ROW_TONE.notBoardedImplied
                              : ROLL_CALL_ROW_TONE.awaiting
                    }`}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2">
                          <strong className="text-base">{member.fullName}</strong>
                          <span className="text-sm text-muted">{member.roles.join(", ")}</span>
                          {recordedHere ? null : (
                            <span
                              className={
                                rc
                                  ? "rounded-full bg-warning/15 px-3 py-1 text-sm font-medium text-warning-strong"
                                  : "rounded-full bg-surface px-3 py-1 text-sm font-medium text-muted"
                              }
                            >
                              {rollCallLabelText(t, rollCallLabel(checkpoint, rc))}
                            </span>
                          )}
                          {/* Crew wear the same chip as a diver — a
                              divemaster who is back while the group they lead
                              is not is the same split, and it must not read
                              differently on their row. */}
                          <BuddyTeamChip
                            label={buddyTeamLabel(member.buddyTeams ?? [])}
                            alertText={
                              member.buddyAlert ? buddyAlertText(t, member.buddyAlert) : null
                            }
                            alert={member.buddyAlert}
                          />
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

        {crewAssigned > 0 ? (
          // Crew change on the morning — a hand calls in sick, a second
          // divemaster is added. The roll call names whoever the trip names
          // *now*, so the way to correct it is the trip's own crew list.
          <Link
            href={`/shop/${shopSlug}/trips/${tripId}#crew`}
            className={buttonClass({ variant: "secondary", className: "mt-4 print:hidden" })}
          >
            {t("trips.manifest.addCrewToTrip")}
          </Link>
        ) : null}
      </section>

      {/*
       * Buddy teams (ADR 20260804-buddy-teams). Grouping is a decision about
       * this departure, made here because this is the surface the roll call
       * runs from. A team is two or more, and a member is a seated diver or a
       * crew person — the divemaster leading a group holds no booking.
       * Management controls only, so the whole panel stays off the printed
       * manifest; the team itself prints on each member's row.
       */}
      <section aria-labelledby="buddy-teams-heading" className="mt-9 print:hidden">
        <h2 id="buddy-teams-heading" className="text-lg font-semibold">
          {t("trips.manifest.buddyHeading")}
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          {t("trips.manifest.buddyDescription")}
        </p>
        {buddyErrorText ? (
          <p className="mt-2 text-sm font-semibold text-danger" role="status">
            {buddyErrorText}
          </p>
        ) : null}
        {buddyTeamsList.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t("trips.manifest.buddyNoTeams")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
            {buddyTeamsList.map((team, index) => {
              // Members of *this* team can't join another, and neither can a
              // diver already on one — so the "add" picker offers whoever is
              // left, plus any crew not already on this team.
              const onThisTeam = new Set(
                team.members.map((member) =>
                  member.kind === "diver" ? `diver:${member.bookingId}` : `crew:${member.personId}`,
                ),
              );
              const free = (options: typeof diverOptions) =>
                options.filter((option) => !onThisTeam.has(option.token));
              const addableDivers = free(diverOptions);
              const addableCrew = free(crewOptions);
              return (
                <li key={team.teamId} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                        {t("trips.manifest.buddyTeamLabel", { number: index + 1 })}
                      </p>
                      <ul className="mt-1.5 flex flex-wrap items-center gap-2">
                        {team.members.map((member) => {
                          const token =
                            member.kind === "diver"
                              ? `diver:${member.bookingId}`
                              : `crew:${member.personId}`;
                          const name =
                            member.kind === "crew"
                              ? t("trips.manifest.buddyCrewName", { name: member.fullName })
                              : member.cancelled
                                ? t("trips.manifest.buddyCancelledName", { name: member.fullName })
                                : member.fullName;
                          // Only a team of three or more can lose a member and
                          // stay a team; at two the act is a dissolve, which
                          // has its own button and its own entry on the trail.
                          const removable = team.members.length > 2;
                          return (
                            <li
                              key={token}
                              className={`flex items-center gap-1 rounded-full border border-border bg-surface-sunken py-1 font-semibold ${
                                removable ? "ps-3 pe-1" : "px-3"
                              }`}
                            >
                              <span>{name}</span>
                              {removable ? (
                                <form action={removeBuddyTeamMemberAction} className="flex">
                                  <input type="hidden" name="teamId" value={team.teamId} />
                                  <input type="hidden" name="member" value={token} />
                                  {/* A real target, not a bare "×" glyph: this
                                      panel is worked on a moving deck, and the
                                      chip shape is what makes the control read
                                      as a control rather than a typo. */}
                                  <button
                                    type="submit"
                                    className="flex size-7 items-center justify-center rounded-full text-lg leading-none text-muted hover:bg-danger/10 hover:text-danger"
                                  >
                                    <span aria-hidden="true">×</span>
                                    <span className="sr-only">
                                      {t("trips.manifest.buddyRemoveMember", {
                                        name: member.fullName,
                                      })}
                                    </span>
                                  </button>
                                </form>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                      <p className="mt-1 text-sm text-muted">
                        {t("trips.manifest.buddyRecordedBy", { name: team.recordedByName })}
                      </p>
                    </div>
                    <form action={dissolveBuddyTeamAction}>
                      <input type="hidden" name="teamId" value={team.teamId} />
                      <button
                        type="submit"
                        className={buttonClass({ variant: "secondary", size: "boat" })}
                      >
                        {t("trips.manifest.buddyDissolve")}
                      </button>
                    </form>
                  </div>
                  {addableDivers.length + addableCrew.length > 0 ? (
                    <form
                      action={addBuddyTeamMemberAction}
                      className="mt-3 flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="teamId" value={team.teamId} />
                      <Field label={t("trips.manifest.buddyAddMemberLabel")}>
                        <select name="member" required defaultValue="" className={controlClass}>
                          <option value="" disabled>
                            {t("trips.manifest.buddySelectPlaceholder")}
                          </option>
                          <optgroup label={t("trips.manifest.buddyDiverGroupLabel")}>
                            {addableDivers.map((option) => (
                              <option key={option.token} value={option.token}>
                                {option.label}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label={t("trips.manifest.buddyCrewGroupLabel")}>
                            {addableCrew.map((option) => (
                              <option key={option.token} value={option.token}>
                                {option.label}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                      </Field>
                      <button
                        type="submit"
                        className={buttonClass({ variant: "secondary", size: "boat" })}
                      >
                        {t("trips.manifest.buddyAddMemberSubmit")}
                      </button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {/*
         * The builder: tick two or more. A multi-select checkbox list rather
         * than N paired dropdowns, because a team has no fixed size and the
         * old two-select form could only ever express the one case the model
         * no longer restricts us to.
         */}
        {diverOptions.length + crewOptions.length >= 2 ? (
          <form action={formBuddyTeamAction} className="mt-4">
            <fieldset className="rounded-lg border border-border bg-surface p-4">
              <legend className="px-1 text-sm font-semibold">
                {t("trips.manifest.buddyNewTeamHeading")}
              </legend>
              <p className="max-w-prose text-sm text-muted">
                {t("trips.manifest.buddyNewTeamHint")}
              </p>
              {diverOptions.length > 0 ? (
                <>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">
                    {t("trips.manifest.buddyDiverGroupLabel")}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2">
                    {diverOptions.map((option) => (
                      <label key={option.token} className="flex items-center gap-2 text-base">
                        <input type="checkbox" name="members" value={option.token} />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </>
              ) : null}
              {crewOptions.length > 0 ? (
                <>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">
                    {t("trips.manifest.buddyCrewGroupLabel")}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2">
                    {crewOptions.map((option) => (
                      <label key={option.token} className="flex items-center gap-2 text-base">
                        <input type="checkbox" name="members" value={option.token} />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </>
              ) : null}
              <div className="mt-4">
                <button type="submit" className={buttonClass({ size: "boat" })}>
                  {t("trips.manifest.buddyFormSubmit")}
                </button>
              </div>
            </fieldset>
          </form>
        ) : unteamedDivers.length === 1 && unteamedDivers[0] ? (
          // An odd roster is normal, never an error — say so instead of
          // rendering a builder that can only fail.
          <p className="mt-3 text-sm text-muted">
            {t("trips.manifest.buddyUnteamedOne", { name: unteamedDivers[0].fullName })}
          </p>
        ) : unteamedDivers.length === 0 && buddyTeamsList.length > 0 ? (
          <p className="mt-3 text-sm text-muted">{t("trips.manifest.buddyEveryoneTeamed")}</p>
        ) : null}
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
            // Each roll-call state gets its own fill (`ROLL_CALL_ROW_TONE`) so
            // staff can tell at a glance who has been handled — aboard green,
            // left ashore amber, not back aboard red, nothing said yet slate.
            const rowClass = `border-l-4 px-4 py-5 sm:px-5 ${
              notBackAboard
                ? `scroll-mt-32 ${ROLL_CALL_ROW_TONE.notBackAboard}`
                : boarded
                  ? ROLL_CALL_ROW_TONE.boarded
                  : explicitNotBoarded
                    ? ROLL_CALL_ROW_TONE.notBoarded
                    : impliedNotBoarded
                      ? ROLL_CALL_ROW_TONE.notBoardedImplied
                      : ready
                        ? ROLL_CALL_ROW_TONE.awaiting
                        : `scroll-mt-32 ${ROLL_CALL_ROW_TONE.blocked}`
            }`;
            // Whether a human has said something about this diver *at this
            // checkpoint*. The two buttons below already carry that answer in
            // words, so the status pill would only repeat them — it stays for
            // the rows nobody has touched, where nothing else says so. An
            // implied not-boarded is carried forward from the dock, not said
            // here, so it keeps its pill.
            const recordedHere = !!rc && !rc.implied;
            // Not a Badge: "carried forward from the dock" needs a fill of its
            // own, a distinction the app's five standard Badge tones don't carry.
            const rollCallPillClass = impliedNotBoarded
              ? "rounded-full bg-warning/15 px-3 py-1 text-sm font-medium text-warning-strong"
              : "rounded-full bg-surface px-3 py-1 text-sm font-medium text-muted";
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
                          which is why it is the word everywhere now. Only the
                          exception is worth a chip: a "Ready" badge on most of
                          a healthy roster is noise that makes the two rows that
                          are *not* ready harder to find, and the blocker list
                          below already spells out why. */}
                      {ready ? null : (
                        <Badge tone={readinessStatusTone(diverStatus)}>
                          {readinessStatusText(t, diverStatus)}
                        </Badge>
                      )}
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
                      {recordedHere ? null : (
                        <span className={rollCallPillClass}>
                          {rollCallLabelText(t, rollCallLabel(checkpoint, rc))}
                        </span>
                      )}
                      <BuddyTeamChip
                        label={buddyTeamLabel(diver.buddyTeam ? [diver.buddyTeam] : [])}
                        alertText={diver.buddyAlert ? buddyAlertText(t, diver.buddyAlert) : null}
                        alert={diver.buddyAlert}
                      />
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

/**
 * The buddy-team chip a roster row wears — quiet while the team's statuses
 * agree, loud when this person is back and someone on their team is not
 * (ADR 20260804-buddy-teams). Words carry the meaning; the tone only agrees
 * with them. Informs only — never a gate.
 *
 * One component for divers and crew, so a split team can never read one way on
 * a diver's row and another on the divemaster's.
 *
 * It takes **words, not a translator**: the same rule staff Client Components
 * follow (AGENTS.md). A resolver function is not serializable into the RSC
 * payload a client navigation streams, so passing `t` here rendered on first
 * load and then threw "Functions cannot be passed directly to Client
 * Components" the moment a form post redirected back — the page came back as
 * the error boundary with no clue why.
 */
function BuddyTeamChip({
  label,
  alertText,
  alert,
}: {
  label: string | null;
  alertText: string | null;
  alert: BuddyAlert | null;
}) {
  if (!label) return null;
  return (
    <span
      className={
        alert === "separated_after_dive"
          ? "rounded-full bg-danger/15 px-3 py-1 text-sm font-bold text-danger"
          : alert === "separated_dock"
            ? "rounded-full bg-warning/10 px-3 py-1 text-sm font-semibold text-warning-strong"
            : "rounded-full bg-surface-sunken px-3 py-1 text-sm font-medium text-muted"
      }
    >
      {alertText ? `${label} · ${alertText}` : label}
    </span>
  );
}
