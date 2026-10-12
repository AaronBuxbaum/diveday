"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { HeldTicket } from "@/components/SendHold";
import { canPersonConfigureTrips, canPersonManagePaymentSettings } from "@/db/authz";
import { type AppDb, getDb } from "@/db/client";
import {
  claimHeldSend,
  executeHeldSend,
  type HeldSendOutcome,
  holdSend,
  pendingHeldSend,
  undoHeldSend,
} from "@/db/held-sends";
import { getShopById } from "@/db/shops";
import { holdRescheduleNotice } from "@/db/trip-rescheduled";
import { trackEvent } from "@/lib/analytics";
import { nowMs } from "@/lib/clock";
import { type HeldSendPayload, heldSendPayloadSchema } from "@/lib/held-sends";
import { majorToMinor, toShopCurrency } from "@/lib/money";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

/**
 * The three moves of a send you can take back (ADR 20260906-before-you-ask,
 * decision 2): hold it, undo it, release it. Every one reads the shop off the
 * session, never off the form, and a held row belongs to exactly one shop.
 */

const LAST_MINUTE_NOTICE = {
  invalid_discount: "last-minute-invalid-discount",
  trip_unavailable: "last-minute-trip-unavailable",
  trip_full: "last-minute-trip-full",
  not_connected: "last-minute-not-connected",
  no_recipients: "last-minute-no-recipients",
  stripe_failed: "last-minute-stripe-failed",
} as const;

const uuidList = (formData: FormData, name: string) => [
  ...new Set(formData.getAll(name).map(String).filter(Boolean)),
];

/**
 * A deal's discount off the form: a percent, or a fixed amount the staffer
 * typed in whole currency units and DiveDay stores in minor units. `discount`
 * and `discountKind` are the deal form's two controls; a bare `discountPercent`
 * is the older single-box spelling and still reads as a percent.
 */
function dealDiscountFromForm(
  formData: FormData,
  currency: string,
): { discountPercent?: number; discountAmountCents?: number } {
  const raw = formData.get("discount") ?? formData.get("discountPercent");
  const value = Number(String(raw ?? "").trim());
  if (formData.get("discountKind") === "amount") {
    return { discountAmountCents: Number.isFinite(value) ? majorToMinor(value, currency) : value };
  }
  return { discountPercent: value };
}

function payloadFromForm(formData: FormData, currency: string): HeldSendPayload {
  const kind = String(formData.get("holdKind") ?? "");
  const optional = (name: string) => String(formData.get(name) ?? "").trim() || undefined;
  const raw =
    kind === "waiver_send"
      ? {
          kind,
          bookingIds: uuidList(formData, "bookingId"),
          personId: optional("personId"),
          // The diver record's three delivery buttons are three submitters on
          // one form, so the channel is the submitter's own name/value pair;
          // anything else is email, as every older caller meant.
          channel: optional("channel") ?? "email",
          surface: optional("surface") ?? "today",
          tripId: optional("tripId"),
        }
      : kind === "last_minute_deal"
        ? {
            kind,
            tripId: optional("tripId"),
            ...dealDiscountFromForm(formData, currency),
            recipientPersonIds: uuidList(formData, "recipientPersonIds"),
          }
        : { kind, tripId: optional("tripId"), entryId: optional("entryId") };
  return heldSendPayloadSchema.parse(raw);
}

/**
 * "Tell them" after an Undo names the departure and nothing else about the
 * move: the time the divers were last told is the server's record
 * (`trips.divers_told_starts_at`), never a form field, so a posted
 * `previousStartsAt` is not read at all.
 */
const tellThemForm = z.object({
  tripId: z.uuid(),
  meetingPointMoved: z.boolean(),
});

export async function holdSendAction(formData: FormData): Promise<HeldTicket> {
  const session = await requireStaffSession();
  const db = await getDb();
  // The shop's currency, only to read a fixed-amount deal's major units.
  if (formData.get("holdKind") === "trip_rescheduled") {
    // "Tell them" after an Undo: the same gate as the move that held it, and
    // the same hold, so a second tap folds into the first rather than sending
    // twice. The recipients are read off the trip at send time, never here.
    if (!(await canPersonConfigureTrips(db, session.user.shopId, session.user.personId))) {
      throw new Error("not_authorized");
    }
    const form = tellThemForm.parse({
      tripId: formData.get("tripId"),
      meetingPointMoved: formData.get("meetingPointMoved") === "true",
    });
    const held = await holdRescheduleNotice(db, {
      shopId: session.user.shopId,
      tripId: form.tripId,
      meetingPointMoved: form.meetingPointMoved,
      actorPersonId: session.user.personId,
    });
    if (!held) throw new Error("nothing_to_send");
    return ticketFor(held);
  }
  const currency = toShopCurrency((await getShopById(db, session.user.shopId))?.currency);
  const payload = payloadFromForm(formData, currency);
  if (payload.kind === "last_minute_deal") {
    // Discounting is money work wherever the button sits (issue #714): the
    // same gate the promo page and the old immediate action stood behind.
    const allowed = await canPersonManagePaymentSettings(
      db,
      session.user.shopId,
      session.user.personId,
    );
    if (!allowed) throw new Error("not_authorized");
  }
  // A reschedule notice is only ever held by a move or by "Tell them" above,
  // both of which take the "before" time from the server's record.
  if (payload.kind === "trip_rescheduled") throw new Error("nothing_to_send");
  return ticketFor(
    await holdSend(db, {
      shopId: session.user.shopId,
      payload,
      actorPersonId: session.user.personId,
    }),
  );
}

/**
 * `holdMs` on the server's own clock, so the client counts it down on its
 * own — the two are never compared (see `HeldTicket`).
 */
function ticketFor(held: { id: string; runAt: Date }): HeldTicket {
  return {
    id: held.id,
    runAt: held.runAt.getTime(),
    holdMs: Math.max(0, held.runAt.getTime() - nowMs()),
  };
}

/**
 * Undo and an early release re-run the gate the hold stood behind, read off
 * the held row's own kind: a crew member who sees a manager's `?held=` id may
 * not take back the manager's reschedule notice or deal blast, nor send it
 * sooner. A row that is gone or not this shop's passes through to the store,
 * which answers it as it always has.
 */
async function assertMayActOnHeld(
  db: AppDb,
  session: { user: { shopId: string; personId: string } },
  id: string,
): Promise<void> {
  const row = await pendingHeldSend(db, session.user.shopId, id);
  if (!row) return;
  const gate =
    row.kind === "trip_rescheduled"
      ? canPersonConfigureTrips
      : row.kind === "last_minute_deal"
        ? canPersonManagePaymentSettings
        : null;
  if (gate && !(await gate(db, session.user.shopId, session.user.personId))) {
    throw new Error("not_authorized");
  }
}

export async function undoHeldSendAction(id: string): Promise<boolean> {
  const session = await requireStaffSession();
  const db = await getDb();
  const heldId = z.uuid().parse(id);
  await assertMayActOnHeld(db, session, heldId);
  return undoHeldSend(db, session.user.shopId, heldId);
}

export type ReleasedSend =
  | { status: "pending" | "gone" }
  | {
      status: "done";
      outcome: HeldSendOutcome & {
        /** Where the surface goes next, for a send that used to end in a redirect. */
        redirectTo?: string;
      };
    };

export async function releaseHeldSendAction(id: string): Promise<ReleasedSend> {
  const session = await requireStaffSession();
  const db = await getDb();
  const heldId = z.uuid().parse(id);
  await assertMayActOnHeld(db, session, heldId);
  // The actor's own countdown is the clock (see `claimHeldSend`).
  const claim = await claimHeldSend(db, session.user.shopId, heldId, undefined, {
    early: true,
  });
  if (claim.status !== "claimed") return { status: claim.status };
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return { status: "gone" };
  const { row } = claim;
  const outcome = await executeHeldSend(db, row);
  const { payload } = row;

  if (payload.kind === "waiver_send") {
    const path =
      payload.surface === "today"
        ? shopPath(shop.slug)
        : payload.surface === "roster" && payload.tripId
          ? shopPath(shop.slug, "trips", payload.tripId)
          : shopPath(shop.slug, "divers", ...(payload.personId ? [payload.personId] : []));
    revalidatePath(path);
    if (outcome.kind === "waiver_send" && outcome.sent.length > 0) {
      await trackEvent({ name: "staff_recovery", kind: "waiver_sent", surface: payload.surface });
    }
    return { status: "done", outcome };
  }

  const tripPath = shopPath(shop.slug, "trips", payload.tripId);
  revalidatePath(tripPath);
  revalidatePath(shopPath(shop.slug));
  if (outcome.kind === "last_minute_deal") {
    const anchor = `${tripPath}?view=details#last-minute-deal`;
    const redirectTo = outcome.outcome.ok
      ? noticeUrl(anchor, "last-minute-sent", { count: outcome.outcome.recipientCount })
      : noticeUrl(anchor, LAST_MINUTE_NOTICE[outcome.outcome.reason]);
    return { status: "done", outcome: { ...outcome, redirectTo } };
  }
  return { status: "done", outcome };
}
