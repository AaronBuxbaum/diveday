"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordPaymentNotice } from "@/app/shop/[shopSlug]/orders/[id]/order-detail-keys";
import type { HeldTicket } from "@/components/SendHold";
import {
  canPersonActOnKind,
  canPersonConfigureTrips,
  canPersonManagePaymentSettings,
} from "@/db/authz";
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
import { dispatchIntegrationsAfterResponse } from "@/features/integrations";
import { trackEvent } from "@/lib/analytics";
import { nowMs } from "@/lib/clock";
import { formValue, parseForm, readForm, single, trimmedText } from "@/lib/form-parse";
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

/** Every value a repeated id field sent, once each and blanks dropped, as `getAll` read it. */
const idList = () =>
  z
    .unknown()
    .optional()
    .transform((value) => {
      const values = value === undefined ? [] : Array.isArray(value) ? value : [value];
      return [...new Set(values.map(String).filter(Boolean))];
    });

/** Text that is absent when blank: a blank or missing box is `undefined`, the rest trimmed. */
const optionalText = () => trimmedText().transform((value) => value || undefined);

/**
 * Every field a hold posts, read raw: `heldSendPayloadSchema` is the one that
 * decides what a hold may carry, so this only gathers the form into its shape.
 */
const heldSendForm = z.object({
  holdKind: formValue().transform((value) => String(value ?? "")),
  bookingId: idList(),
  personId: optionalText(),
  channel: optionalText(),
  surface: optionalText(),
  tripId: optionalText(),
  ticketId: optionalText(),
  interestId: idList(),
  discount: formValue(),
  discountPercent: formValue(),
  discountKind: formValue(),
});
type HeldSendForm = z.infer<typeof heldSendForm>;

/**
 * An offer's discount off the form: a percent, or a fixed amount the staffer
 * typed in whole currency units and DiveDay stores in minor units. `discount`
 * and `discountKind` are the deal form's two controls; a bare `discountPercent`
 * is the older single-box spelling and still reads as a percent.
 */
function offerDiscountFromForm(
  form: HeldSendForm,
  currency: string,
): { percent: number } | { amountCents: number } {
  const raw = form.discount ?? form.discountPercent;
  const value = Number(String(raw ?? "").trim());
  if (form.discountKind === "amount") {
    return { amountCents: Number.isFinite(value) ? majorToMinor(value, currency) : value };
  }
  return { percent: value };
}

function payloadFromForm(formData: FormData, currency: string): HeldSendPayload {
  const parsed = parseForm(heldSendForm, formData);
  if (!parsed.ok) throw new Error("unreadable hold form");
  const form = parsed.data;
  const kind = form.holdKind;
  // A discount's kind with no amount is a discount the staffer meant and
  // left blank: refused, never sent on as an ordinary offer (layer 3 review).
  if (
    kind === "seat_offer" &&
    String(form.discountKind ?? "").trim() !== "" &&
    String(form.discount ?? form.discountPercent ?? "").trim() === ""
  ) {
    throw new Error("invalid_discount");
  }
  const raw =
    kind === "waiver_send"
      ? {
          kind,
          bookingIds: form.bookingId,
          personId: form.personId,
          // The diver record's three delivery buttons are three submitters on
          // one form, so the channel is the submitter's own name/value pair;
          // anything else is email, as every older caller meant.
          channel: form.channel ?? "email",
          surface: form.surface ?? "today",
          tripId: form.tripId,
          ticketId: form.ticketId,
        }
      : {
          kind,
          tripId: form.tripId,
          interestIds: form.interestId,
          // A blank box is no discount: an ordinary offer.
          ...(String(form.discount ?? form.discountPercent ?? "").trim() === ""
            ? {}
            : { discount: offerDiscountFromForm(form, currency) }),
        };
  return heldSendPayloadSchema.parse(raw);
}

/**
 * "Tell them" after an Undo names the departure and nothing else about the
 * move: the time the divers were last told and whether the meeting point moved
 * are the server's record (`trips.divers_told_starts_at`,
 * `trips.divers_told_meeting_point`), never form fields, so a posted
 * `previousStartsAt` or `meetingPointMoved` is not read at all.
 */
const tellThemForm = z.object({ tripId: single(z.uuid()) });
const holdKindForm = z.object({ holdKind: formValue() });

export async function holdSendAction(formData: FormData): Promise<HeldTicket> {
  const session = await requireStaffSession();
  const db = await getDb();
  // The shop's currency, only to read a fixed-amount deal's major units.
  if (readForm(holdKindForm, formData).holdKind === "trip_rescheduled") {
    // "Tell them" after an Undo: the same gate as the move that held it, and
    // the same hold, so a second tap folds into the first rather than sending
    // twice. The recipients are read off the trip at send time, never here.
    if (!(await canPersonConfigureTrips(db, session.user.shopId, session.user.personId))) {
      throw new Error("not_authorized");
    }
    const tell = parseForm(tellThemForm, formData);
    if (!tell.ok) throw new Error("unreadable hold form");
    const form = tell.data;
    // Whether the meeting point moved is the server's record too
    // (`trips.divers_told_meeting_point`): a posted `meetingPointMoved` is not read.
    const held = await holdRescheduleNotice(db, {
      shopId: session.user.shopId,
      tripId: form.tripId,
      actorPersonId: session.user.personId,
    });
    if (!held) throw new Error("nothing_to_send");
    return ticketFor(held);
  }
  const currency = toShopCurrency((await getShopById(db, session.user.shopId))?.currency);
  const payload = payloadFromForm(formData, currency);
  if (payload.kind === "seat_offer" && payload.discount) {
    // Discounting is money work wherever the button sits (issue #714): the
    // same gate the promo page and the old immediate action stood behind.
    const allowed = await canPersonManagePaymentSettings(
      db,
      session.user.shopId,
      session.user.personId,
    );
    if (!allowed) throw new Error("not_authorized");
  }
  // An offer of a seat is Today’s `seat_wanted` row: what Today hides from
  // a role, the action refuses it too (issue #2134).
  if (
    payload.kind === "seat_offer" &&
    !(await canPersonActOnKind(db, session.user.shopId, session.user.personId, "seat_wanted"))
  ) {
    throw new Error("not_authorized");
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
      : row.kind === "seat_offer" && row.payload.kind === "seat_offer" && row.payload.discount
        ? canPersonManagePaymentSettings
        : null;
  if (gate && !(await gate(db, session.user.shopId, session.user.personId))) {
    throw new Error("not_authorized");
  }
  if (
    row.kind === "seat_offer" &&
    !(await canPersonActOnKind(db, session.user.shopId, session.user.personId, "seat_wanted"))
  ) {
    throw new Error("not_authorized");
  }
}

export async function undoHeldSendAction(id: string): Promise<boolean> {
  const session = await requireStaffSession();
  // A stale or hand-posted id is nothing to undo, not a 500.
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return false;
  const heldId = parsed.data;
  const db = await getDb();
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

/**
 * The page a waiver send was made from, refreshed once it lands. A counter
 * send refreshes the rental ticket it was made on, or the new-rental form
 * when the person was still choosing gear (issue #2346).
 */
function waiverSendPath(
  slug: string,
  payload: Extract<HeldSendPayload, { kind: "waiver_send" }>,
): string {
  if (payload.surface === "today") return shopPath(slug);
  if (payload.surface === "roster" && payload.tripId) {
    return shopPath(slug, "trips", payload.tripId);
  }
  if (payload.surface === "counter") {
    return payload.ticketId
      ? shopPath(slug, "gear", "rentals", payload.ticketId)
      : shopPath(slug, "gear", "rentals", "new");
  }
  return shopPath(slug, "divers", ...(payload.personId ? [payload.personId] : []));
}

export async function releaseHeldSendAction(id: string): Promise<ReleasedSend> {
  const session = await requireStaffSession();
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { status: "gone" };
  const heldId = parsed.data;
  const db = await getDb();
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
    revalidatePath(waiverSendPath(shop.slug, payload));
    if (outcome.kind === "waiver_send" && outcome.sent.length > 0) {
      await trackEvent({ name: "staff_recovery", kind: "waiver_sent", surface: payload.surface });
    }
    return { status: "done", outcome };
  }

  if (payload.kind === "counter_payment") {
    // The order page shows what the release recorded, as the one-tap
    // button's redirect did (issue #3030).
    const back = shopPath(shop.slug, "orders", payload.orderId);
    revalidatePath(back);
    revalidatePath(shopPath(shop.slug, "orders"));
    if (outcome.kind === "counter_payment") {
      if (outcome.outcome.ok) dispatchIntegrationsAfterResponse();
      const redirectTo = noticeUrl(
        back,
        recordPaymentNotice(outcome.outcome, { demo: outcome.demo }),
      );
      return { status: "done", outcome: { ...outcome, redirectTo } };
    }
    return { status: "done", outcome };
  }

  const tripPath = shopPath(shop.slug, "trips", payload.tripId);
  revalidatePath(tripPath);
  revalidatePath(shopPath(shop.slug));
  if (outcome.kind === "seat_offer" && outcome.deal) {
    const anchor = `${tripPath}?view=details#last-minute-deal`;
    const redirectTo = outcome.deal.ok
      ? noticeUrl(anchor, "last-minute-sent", { count: outcome.deal.recipientCount })
      : noticeUrl(anchor, LAST_MINUTE_NOTICE[outcome.deal.reason]);
    return { status: "done", outcome: { ...outcome, redirectTo } };
  }
  return { status: "done", outcome };
}
