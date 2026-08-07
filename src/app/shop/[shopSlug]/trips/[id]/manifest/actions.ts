"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { RollCallResult } from "@/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton";
import {
  addBuddyTeamMember,
  type BuddyTeamMemberInput,
  dissolveBuddyTeam,
  formBuddyTeam,
  removeBuddyTeamMember,
} from "@/db/buddy-pairs";
import { type AppDb, getDb } from "@/db/client";
import { recordCrewRollCall, recordRollCall, updateLatestRollCallNote } from "@/db/manifests";
import {
  deletePushSubscription,
  isDeviceSubscribed,
  isDeviceSubscribedAnywhere,
  savePushSubscription,
} from "@/db/push-subscriptions";
import { getTripWithBooked } from "@/db/trips";
import { trackEvent } from "@/lib/analytics";
import { isRollCallCheckpoint, type RollCallCheckpoint } from "@/lib/manifests";
import { revalidateAndRedirect } from "@/lib/navigation";
import { isAllowedPushEndpoint } from "@/lib/notifications/web-push";
import { requireStaffSession } from "@/lib/session";
import { UUID_SOURCE } from "@/lib/uuid";

/* -------------------------------------------------------------------------- *
 * The boat manifest's mutations
 *
 * Every one of these used to be an inline `"use server"` closure inside
 * `page.tsx`, capturing `tripId`, `checkpoint`, `back`, and `plannedDives` from
 * the render. At module scope they take that context as **one bound leading
 * argument** instead (the page binds it once and hands the bound action to the
 * section that renders it), which is the same channel a closure used — Next
 * serializes and seals what an action carries either way — and re-prove
 * anything the client can still reach: the note action re-derives this trip's
 * planned-dive count from the trip row rather than believing a posted
 * checkpoint, and the two roll-call writers re-prove the checkpoint inside
 * their own transaction (see `provenCheckpoint`).
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
 * The note action needs no checkpoint of its own: the one it annotates arrives
 * with the note and is re-proved against the trip row (`provenCheckpoint`), so
 * it takes the narrower context rather than pretending to use a bound one.
 */
export type ManifestTripContext = Omit<ManifestActionContext, "checkpoint">;

/**
 * The manifest route these actions belong to. In the page this was
 * `back.split("?")[0]`, the same string, built once from the values the page
 * already had in scope; here it is rebuilt from the two bound arguments so
 * `revalidatePath` still names the route without its query.
 */
function manifestPath({ shopSlug, tripId }: ManifestTripContext): string {
  return `/shop/${shopSlug}/trips/${tripId}/manifest`;
}

/**
 * Where a buddy-team act lands when it is done — the same checkpoint the
 * staffer was working, so a refusal returns them to the list they were looking
 * at rather than to "departure". This is the page's old `back`. It is a
 * relative path built from bound values, never anything a caller supplied.
 */
function manifestBack(ctx: ManifestActionContext): string {
  return `${manifestPath(ctx)}?checkpoint=${ctx.checkpoint}`;
}

/**
 * Re-prove a checkpoint the *client* handed us against this trip's own planned
 * dive count, read from the trip row inside the request.
 *
 * The page used to hold `plannedDives` in scope and check against it. A
 * module-scope action has no such scope, and a `plannedDives` posted alongside
 * the checkpoint would be the client vouching for itself — so the count comes
 * from the trip, scoped to the staffer's own shop, every time.
 *
 * `recordRollCall` and `recordCrewRollCall` already run exactly this proof
 * inside their transaction and refuse with `invalid_checkpoint`, which is why
 * the two tap-path actions below don't pay for a second read of the same row
 * on a boat's flaky connection; this is here for the note action, whose writer
 * annotates whatever checkpoint it is handed.
 */
async function provenCheckpoint(
  db: AppDb,
  shopId: string,
  tripId: string,
  value: string,
): Promise<RollCallCheckpoint | null> {
  const trip = await getTripWithBooked(db, shopId, tripId);
  if (!trip) return null;
  return isRollCallCheckpoint(value, trip.plannedDives) ? value : null;
}

const rollCallSchema = z.object({
  bookingId: z.string().uuid(),
  status: z.enum(["boarded", "not_boarded", "cleared"]),
  note: z.string().trim().max(300).optional(),
});

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
function buddyErrorCode(reason: string): string {
  if (reason === "duplicate_member") return "duplicate";
  if (reason === "already_teamed") return "teamed";
  if (reason === "too_few_members") return "few";
  return "generic";
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
      // Re-proved against this trip's own `plannedDives` inside the write's
      // transaction (`invalid_checkpoint`) — see `provenCheckpoint` above.
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
  revalidatePath(manifestPath(ctx));
  return { ok: true };
}

export async function saveRollCallNoteAction(
  ctx: ManifestTripContext,
  bookingId: string,
  checkpointValue: string,
  note: string,
): Promise<{ ok: boolean; saved: boolean }> {
  const staff = await requireStaffSession();
  const parsed = noteSchema.safeParse({ bookingId, checkpoint: checkpointValue, note });
  if (!parsed.success) return { ok: false, saved: false };
  const { tripId } = ctx;
  const db = await getDb();
  const checkpoint = await provenCheckpoint(db, staff.user.shopId, tripId, parsed.data.checkpoint);
  if (!checkpoint) {
    return { ok: false, saved: false };
  }
  const saved = await updateLatestRollCallNote(db, {
    shopId: staff.user.shopId,
    tripId,
    bookingId: parsed.data.bookingId,
    checkpoint,
    note: parsed.data.note,
  });
  if (saved) revalidatePath(manifestPath(ctx));
  return { ok: true, saved };
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
