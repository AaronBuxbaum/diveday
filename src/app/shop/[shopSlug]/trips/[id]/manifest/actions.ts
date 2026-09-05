"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { RollCallResult } from "@/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton";
import {
  addBuddyTeamMember,
  type BuddyTeamMemberInput,
  type BuddyTeamRefusal,
  dissolveBuddyTeam,
  formBuddyTeam,
  removeBuddyTeamMember,
} from "@/db/buddy-pairs";
import { getDb } from "@/db/client";
import { markTripCaughtUp } from "@/db/desk-events";
import { type ExecutedDiveRefusal, upsertExecutedDive } from "@/db/executed-dives";
import { recordCrewRollCall, recordRollCall } from "@/db/manifests";
import { addInternalNote } from "@/db/operations";
import { recordPreDepartureCheck } from "@/db/pre-departure-check";
import {
  deletePushSubscription,
  isDeviceSubscribed,
  isDeviceSubscribedAnywhere,
  savePushSubscription,
} from "@/db/push-subscriptions";
import { getShopById } from "@/db/shops";
import { trackEvent } from "@/lib/analytics";
import { nowDate } from "@/lib/clock";
import { depthToMeters, MAX_ENTERED_DEPTH_METERS } from "@/lib/depth-units";
import { ROLL_CALL_NOTE_MAX, type RollCallCheckpoint } from "@/lib/manifests";
import { revalidateAndRedirect } from "@/lib/navigation";
import { isAllowedPushEndpoint } from "@/lib/notifications/web-push";
import { PLAN_CHANGE_NOTE_MAX, PLAN_CHANGE_REASONS } from "@/lib/plan-change";
import { requireStaffSession } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { UUID_SOURCE } from "@/lib/uuid";
import { parseWallTime, wallTimeToUtc } from "@/lib/zoned";

/* -------------------------------------------------------------------------- *
 * The boat manifest's mutations
 *
 * Every one of these used to be an inline `"use server"` closure inside
 * `page.tsx`, capturing `tripId`, `checkpoint`, `back`, and `plannedDives` from
 * the render. At module scope they take that context as **one bound leading
 * argument** instead (the page binds it once and hands the bound action to the
 * section that renders it), which is the same channel a closure used — Next
 * serializes and seals what an action carries either way — and re-prove
 * anything the client can still reach: a private note is scoped to the bound
 * trip and booking by the database operation, and the two roll-call writers
 * re-prove the checkpoint inside their own transaction.
 *
 * The context is a **named object, not three positional strings**. `shopSlug`
 * and `tripId` are both opaque ids of the same shape, and at a `.bind` call
 * site swapping them is a silent, well-typed mistake that revalidates the
 * wrong route.
 *
 * Nothing about what these accept, refuse, record, or redirect to changed.
 * -------------------------------------------------------------------------- */

/**
 * Where an action on this page is happening: whose shop's route to revalidate,
 * which departure, and — for everything that writes or lands at a checkpoint —
 * which checkpoint the staffer was working.
 */
export type ManifestActionContext = {
  shopSlug: string;
  tripId: string;
  checkpoint: RollCallCheckpoint;
};

/**
 * Private notes need no checkpoint of their own. They are booking-scoped staff
 * context, so they can be written before boarding and remain available on the
 * Guests roster and the live manifest.
 */
export type ManifestTripContext = Omit<ManifestActionContext, "checkpoint">;

/**
 * The manifest route these actions belong to. In the page this was
 * `back.split("?")[0]`, the same string, built once from the values the page
 * already had in scope; here it is rebuilt from the two bound arguments so
 * `revalidatePath` still names the route without its query.
 */
function manifestPath({ shopSlug, tripId }: ManifestTripContext): string {
  return shopPath(shopSlug, "trips", tripId, "manifest");
}

/**
 * Where a buddy-team act lands when it is done — the same checkpoint the
 * staffer was working, so a refusal returns them to the list they were looking
 * at rather than to "departure". This is the page's old `back`. It is a
 * relative path built from bound values, never anything a caller supplied.
 *
 * `buddies=open`: the teams panel sits collapsed at rest, and every one of
 * these acts both starts inside it and redirects. Without this the panel
 * would fold shut after each successful step of a session that plainly isn't
 * finished (form a team, add the third, form the next), so the redirect says
 * to arrive with it open.
 */
function manifestBack(ctx: ManifestActionContext): string {
  // `checkpoint` is escaped rather than interpolated raw: it reaches these
  // actions as a bound argument like the slug, and one carrying `&` would
  // append query params of its own to the URL a notice is then added to.
  return `${manifestPath(ctx)}?checkpoint=${encodeURIComponent(ctx.checkpoint)}&buddies=open`;
}

const rollCallSchema = z.object({
  bookingId: z.string().uuid(),
  status: z.enum(["boarded", "not_boarded", "cleared"]),
  /**
   * What the crew observed about a person who is unaccounted for. Bounded here
   * and narrowed again in the write, which keeps it only at an after-dive
   * checkpoint (`rollCallNoteAllowed`) — so this field cannot put free text on
   * a departure event the surface never offered a box for.
   */
  note: z.string().trim().max(ROLL_CALL_NOTE_MAX).optional(),
});

const executedDiveSchema = z.object({
  diveNumber: z.coerce.number().int().min(1).max(20),
  actualSiteId: z.union([z.literal(""), z.string().uuid()]),
  enteredAt: z.string().optional(),
  exitedAt: z.string().optional(),
  maxDepthMeters: z.union([z.literal(""), z.coerce.number().finite().min(0)]),
  visibility: z.string().trim().max(120).optional(),
  current: z.string().trim().max(120).optional(),
  // Bounded here, believed nowhere: `upsertExecutedDive` checks it against the
  // catalog *and* against the site's own field guide, since a constraint that
  // lives in a `<select>` is a suggestion (issue #1190).
  observedSpeciesSlug: z.union([z.literal(""), z.string().trim().max(80)]).optional(),
  // Bounded here and refused again in the write: a note with no reason above it
  // is `upsertExecutedDive`'s own refusal, because the pairing is a domain rule
  // and a `<select>` beside a `<textarea>` is a suggestion (issue #1184).
  planChangeReason: z.union([z.literal(""), z.enum(PLAN_CHANGE_REASONS)]).optional(),
  planChangeNote: z.string().trim().max(PLAN_CHANGE_NOTE_MAX).optional(),
});

/**
 * What the dive log form is told when its entry does not land.
 *
 * Every path out of the action used to be a bare `return`, on a safety surface,
 * at the rail: a divemaster who typed a transposed entry and exit time saved
 * nothing, was told nothing, and watched the form come back holding the last
 * saved row. The likeliest reading of that is "it saved" — and what is written
 * here is what `buildIncidentExport` later seals into a document an
 * investigator or a treating physician reads (issue #1018).
 */
export type ExecutedDiveResult =
  | { status: "ok" }
  | { status: "error"; reason: ExecutedDiveRefusal | "invalid" | "invalid_time" | "wrong_dive" };

/**
 * *Got it* — this staffer has read the catch-up strip (issues #1202, #1187).
 *
 * The whole act, and deliberately nothing more: it takes no form data, returns
 * nothing, and redirects nowhere. The strip is above the instrument on a
 * safety surface, so the outcome of dismissing it is that it stops being there;
 * a toast confirming that would be a second thing to read on the busiest screen
 * in the app.
 *
 * `markTripCaughtUp` re-proves the departure against the signed-in shop before
 * it writes, and the mark is keyed to `staff.user.personId` rather than
 * anything the client sent — a tap can only ever move the tapper's own mark.
 */
export async function markTripCaughtUpAction(ctx: ManifestTripContext): Promise<void> {
  const staff = await requireStaffSession();
  await markTripCaughtUp(await getDb(), {
    shopId: staff.user.shopId,
    tripId: ctx.tripId,
    personId: staff.user.personId,
    now: nowDate(),
  });
  revalidatePath(manifestPath(ctx));
}

/** Record what actually happened after a dive, including an honest unknown. */
export async function saveExecutedDiveAction(
  ctx: ManifestActionContext,
  _previous: ExecutedDiveResult | undefined,
  formData: FormData,
): Promise<ExecutedDiveResult> {
  const staff = await requireStaffSession();
  const parsed = executedDiveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", reason: "invalid" };
  const checkpointDive = /^after_dive_(\d+)$/.exec(ctx.checkpoint)?.[1];
  if (!checkpointDive || Number(checkpointDive) !== parsed.data.diveNumber) {
    return { status: "error", reason: "wrong_dive" };
  }
  const shop = await getShopById(await getDb(), staff.user.shopId);
  if (!shop) return { status: "error", reason: "invalid" };
  const dateOrNull = (value: string | undefined) => {
    if (!value) return null;
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
    if (!match) return null;
    const wall = parseWallTime(match[1], match[2]);
    return wall ? wallTimeToUtc(wall, shop.timezone) : null;
  };
  const enteredAt = dateOrNull(parsed.data.enteredAt);
  const exitedAt = dateOrNull(parsed.data.exitedAt);
  if (parsed.data.enteredAt && !enteredAt) return { status: "error", reason: "invalid_time" };
  if (parsed.data.exitedAt && !exitedAt) return { status: "error", reason: "invalid_time" };
  const notRecorded = formData.getAll("notRecorded").map(String);
  const maxDepthMeters =
    notRecorded.includes("depth") || parsed.data.maxDepthMeters === ""
      ? null
      : depthToMeters(parsed.data.maxDepthMeters, shop.depthUnit);
  if (maxDepthMeters !== null && maxDepthMeters > MAX_ENTERED_DEPTH_METERS) {
    return { status: "error", reason: "depth_out_of_range" };
  }
  const saved = await upsertExecutedDive(await getDb(), {
    shopId: staff.user.shopId,
    tripId: ctx.tripId,
    diveNumber: parsed.data.diveNumber,
    actualSiteId: parsed.data.actualSiteId || null,
    enteredAt,
    exitedAt,
    maxDepthMeters,
    observedConditions: {
      visibility: parsed.data.visibility || null,
      current: parsed.data.current || null,
    },
    notRecorded,
    observedSpeciesSlug: parsed.data.observedSpeciesSlug || null,
    planChangeReason: parsed.data.planChangeReason || null,
    planChangeNote: parsed.data.planChangeNote || null,
    recordedByPersonId: staff.user.personId,
  });
  if (!saved.ok) return { status: "error", reason: saved.reason };
  revalidatePath(manifestPath(ctx));
  return { status: "ok" };
}

/**
 * The endpoint is a URL the *browser* supplies that this server later POSTs to,
 * so it is validated against the known push services rather than merely parsed
 * — see `isAllowedPushEndpoint`. The key material is base64url and bounded;
 * both are opaque to us beyond that.
 */
const pushEndpointSchema = z.string().refine(isAllowedPushEndpoint);
const pushSubscriptionSchema = z.object({
  endpoint: pushEndpointSchema,
  p256dh: z.string().min(1).max(256),
  auth: z.string().min(1).max(256),
});

const privateNoteSchema = z.object({
  bookingId: z.string().uuid(),
  note: z.string().trim().min(1).max(1_000),
});

// The crew subject is a `people.id`, never a booking. The server re-proves the
// person is assigned to *this* trip before writing anything (`recordCrewRollCall`).
const crewRollCallSchema = z.object({
  personId: z.string().uuid(),
  status: z.enum(["boarded", "not_boarded", "cleared"]),
  /** The same, for the other half of the head count. */
  note: z.string().trim().max(ROLL_CALL_NOTE_MAX).optional(),
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
//
// The id half is a **real UUID**, and it is normalised to lower case before it
// leaves this file. The first cut of this matched `[0-9a-fA-F-]{36}`, which is
// neither: `------------------------------------` satisfied it and reached
// Postgres as an invalid uuid literal (an unhandled 500 rather than one of the
// nine designed refusals), and an **upper-cased** copy of a real id satisfied
// it *and* matched the row — Postgres compares uuids canonically — while the
// name lookup keyed on the caller's spelling missed. The result was an
// `ok: true` that wrote `[null, null]` into the append-only safety trail and
// left this departure's incident export throwing forever, from any staff
// account, by editing a checkbox value in devtools. `src/db/buddy-pairs.ts`
// now resolves names off the returned row rather than the caller's string, so
// this is the outer of two layers, not the only one.
const memberTokenSchema = z
  .string()
  .regex(new RegExp(`^(?:diver|crew):${UUID_SOURCE}$`, "i"), "member token");

function parseMemberToken(token: string): BuddyTeamMemberInput {
  const [kind, id] = token.split(":");
  const normalised = (id ?? "").toLowerCase();
  return kind === "diver"
    ? { kind: "diver", bookingId: normalised }
    : { kind: "crew", personId: normalised };
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
 * is about the least helpful way a mistake can present itself. (That constraint
 * is also what makes this whole file safe: these actions never referenced
 * anything from the render but plain strings and numbers.)
 */
/**
 * What a team refusal is called in `?buddyError=`, which the manifest page
 * resolves to a sentence.
 *
 * Keyed by the domain union rather than taking a `string`, which is what this
 * was: an `if` ladder over four spellings with a `return "generic"` at the end,
 * so a tenth refusal silently became "generic" and nobody found out. The five
 * that genuinely share the generic message say so by name here — the manifest
 * page has one sentence for "that didn't work", and these are the cases where
 * it is the honest one.
 */
const BUDDY_ERROR_CODE: Record<BuddyTeamRefusal, string> = {
  duplicate_member: "duplicate",
  already_teamed: "teamed",
  too_few_members: "few",
  staff_not_found: "generic",
  trip_unavailable: "generic",
  booking_unavailable: "generic",
  crew_unavailable: "generic",
  team_not_found: "generic",
  not_a_member: "generic",
};

function buddyErrorCode(reason: BuddyTeamRefusal): string {
  return BUDDY_ERROR_CODE[reason];
}

// Web Push opt-in for this device (ADR 20260804-manifest-web-push). Both
// actions re-derive the shop from the session rather than trusting anything
// the client sent, so one shop's staff can never register or drop a
// subscription against another's trip; `savePushSubscription` additionally
// refuses a trip that isn't theirs.
export async function subscribePushAction(
  tripId: string,
  input: {
    endpoint: string;
    p256dh: string;
    auth: string;
  },
): Promise<{ ok: boolean }> {
  const staff = await requireStaffSession();
  const parsed = pushSubscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const outcome = await savePushSubscription(await getDb(), {
    shopId: staff.user.shopId,
    tripId,
    personId: staff.user.personId,
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.p256dh,
    auth: parsed.data.auth,
  });
  return { ok: outcome.ok };
}

export async function unsubscribePushAction(
  tripId: string,
  endpoint: string,
): Promise<{ ok: boolean; hasOtherTrips: boolean }> {
  const staff = await requireStaffSession();
  const parsed = pushEndpointSchema.safeParse(endpoint);
  if (!parsed.success) return { ok: false, hasOtherTrips: false };
  const outcome = await deletePushSubscription(
    await getDb(),
    staff.user.shopId,
    tripId,
    parsed.data,
  );
  return { ok: true, hasOtherTrips: outcome.hasOtherTrips };
}

// Read by the control on mount. The browser's own subscription object is
// origin-wide, so only the server can say whether *this* trip is on.
export async function isPushSubscribedAction(tripId: string, endpoint: string): Promise<boolean> {
  const staff = await requireStaffSession();
  const parsed = pushEndpointSchema.safeParse(endpoint);
  if (!parsed.success) return false;
  return isDeviceSubscribed(await getDb(), staff.user.shopId, tripId, parsed.data);
}

export async function isPushSubscribedAnywhereAction(endpoint: string): Promise<boolean> {
  const staff = await requireStaffSession();
  const parsed = pushEndpointSchema.safeParse(endpoint);
  if (!parsed.success) return false;
  return isDeviceSubscribedAnywhere(await getDb(), staff.user.shopId, parsed.data);
}

export async function rollCallAction(
  ctx: ManifestActionContext,
  _prev: RollCallResult,
  formData: FormData,
): Promise<RollCallResult> {
  const { tripId, checkpoint } = ctx;
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
      note: parsed.data.note,
      // Re-proved against this trip's own `plannedDives` inside the write's
      // transaction (`invalid_checkpoint`).
      checkpoint,
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
  revalidatePath(manifestPath(ctx));
  return { ok: true };
}

const preDepartureCheckSchema = z.object({
  checklistItemId: z.string().uuid(),
  status: z.enum(["checked", "cleared"]),
});

/** The one refusal a staffer can act on; everything else reads as "try again". */
export type PreDepartureCheckResult = { ok: true } | { ok: false; reason: "error" } | null;

/**
 * Record one tap against one pre-departure checklist item (ADR
 * 20260824-pre-departure-safety-check). Checkpoint-independent — unlike
 * `rollCallAction`, this takes the trip-only context, because the check
 * happens once before the boat leaves, not once per dive.
 */
export async function preDepartureCheckAction(
  ctx: ManifestTripContext,
  _prev: PreDepartureCheckResult,
  formData: FormData,
): Promise<PreDepartureCheckResult> {
  const staff = await requireStaffSession();
  const parsed = preDepartureCheckSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, reason: "error" };
  try {
    const outcome = await recordPreDepartureCheck(await getDb(), {
      shopId: staff.user.shopId,
      tripId: ctx.tripId,
      checklistItemId: parsed.data.checklistItemId,
      recordedByPersonId: staff.user.personId,
      status: parsed.data.status,
    });
    if (!outcome.ok) return { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
  revalidatePath(manifestPath(ctx));
  return { ok: true };
}

/**
 * Add the same booking-scoped private note used by the Guests roster. This is
 * intentionally independent of roll-call state: a staffer can record context
 * for a diver before anybody has been marked boarded, and the note lands in
 * the existing audited `internal_notes` history immediately.
 */
export async function addManifestPrivateNoteAction(
  ctx: ManifestTripContext,
  formData: FormData,
): Promise<void> {
  const staff = await requireStaffSession();
  const parsed = privateNoteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const saved = await addInternalNote(await getDb(), {
    shopId: staff.user.shopId,
    tripId: ctx.tripId,
    bookingId: parsed.data.bookingId,
    actorPersonId: staff.user.personId,
    body: parsed.data.note,
  });
  if (saved) revalidatePath(manifestPath(ctx));
}

/**
 * Record one crew member's own result at this checkpoint (DOM-H1, ADR
 * 20260803-per-person-crew-roll-call). Same control, same refusal handling,
 * and the same append-only write a diver gets — the subject is a `people.id`
 * instead of a booking, and readiness never applies to crew.
 */
export async function crewRollCallAction(
  ctx: ManifestActionContext,
  _prev: RollCallResult,
  formData: FormData,
): Promise<RollCallResult> {
  const { tripId, checkpoint } = ctx;
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
      note: parsed.data.note,
      // Same re-proof the diver write runs: the checkpoint is checked against
      // the trip row inside the transaction, never against anything posted.
      checkpoint,
    });
    // Every refusal reads the same on the boat: the tap did not stick. The
    // distinctions (`crew_not_assigned`, `trip_unavailable`) are server-side
    // codes, not something to explain to someone with wet hands.
    if (!outcome.ok) return { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
  revalidatePath(manifestPath(ctx));
  return { ok: true };
}

/**
 * Form a buddy team from two or more people (ADR 20260804-buddy-teams). A
 * plain form post rather than an optimistic control: pairing is a deliberate
 * desk/dock act, not a mid-roll-call tap, so it settles only once the server
 * has written every member row and the trail entry behind them. Every
 * refusal re-lands on this checkpoint with a worded reason.
 */
export async function formBuddyTeamAction(ctx: ManifestActionContext, formData: FormData) {
  const staff = await requireStaffSession();
  const { tripId } = ctx;
  const back = manifestBack(ctx);
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
  revalidateAndRedirect(manifestPath(ctx), back);
}

/** Add one more person to a team that already stands. */
export async function addBuddyTeamMemberAction(ctx: ManifestActionContext, formData: FormData) {
  const staff = await requireStaffSession();
  const { tripId } = ctx;
  const back = manifestBack(ctx);
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
  revalidateAndRedirect(manifestPath(ctx), back);
}

/**
 * Drop one person from a team that keeps standing. The server refuses a
 * removal that would leave fewer than two, which is why this control only
 * appears on teams of three or more — dissolving is its own act, with its
 * own entry on the trail.
 */
export async function removeBuddyTeamMemberAction(ctx: ManifestActionContext, formData: FormData) {
  const staff = await requireStaffSession();
  const { tripId } = ctx;
  const back = manifestBack(ctx);
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
  revalidateAndRedirect(manifestPath(ctx), back);
}

/** Dissolve a team — the explicit act re-forming always goes through. */
export async function dissolveBuddyTeamAction(ctx: ManifestActionContext, formData: FormData) {
  const staff = await requireStaffSession();
  const { tripId } = ctx;
  const back = manifestBack(ctx);
  const parsed = teamSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${back}&buddyError=generic`);
  const outcome = await dissolveBuddyTeam(await getDb(), {
    shopId: staff.user.shopId,
    tripId,
    teamId: parsed.data.teamId,
    recordedByPersonId: staff.user.personId,
  });
  if (!outcome.ok) redirect(`${back}&buddyError=generic`);
  revalidateAndRedirect(manifestPath(ctx), back);
}
