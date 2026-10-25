import { and, eq, lte } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  type HeldSendKind,
  type HeldSendPayload,
  heldSendPayloadSchema,
  heldSendRunAt,
  isHeldSendDue,
} from "@/lib/held-sends";
import { log } from "@/lib/log";
import type { AppDb } from "./client";
import type { CounterPaymentOutcome } from "./counter-payment-hold";
import { type SendDepartureNoteOutcome, sendDepartureNote } from "./departure-notes";
import type { SeatOffersOutcome } from "./interest-offers";
import { heldSends } from "./schema";
import type { RescheduleNoticeOutcome } from "./trip-rescheduled";
import { deliverWaiverBatch, type WaiverBatchOutcome } from "./waiver-issue";

/**
 * The held sends (ADR 20260906-before-you-ask, decision 2).
 *
 * A row is a send that has been tapped and not yet left. It exists for the
 * length of the hold and is **deleted** on either exit: Undo deletes it before
 * it is due, and a claim deletes it as the send begins — an atomic `DELETE …
 * RETURNING`, so the client that counted down and the cron that sweeps
 * stragglers can both try and exactly one of them sends. Nothing prunes this
 * table because nothing lingers in it.
 */
export type HeldSendRow = {
  id: string;
  shopId: string;
  kind: HeldSendKind;
  payload: HeldSendPayload;
  actorPersonId: string | null;
  runAt: Date;
};

export type HeldSendOutcome =
  | ({ kind: "waiver_send" } & WaiverBatchOutcome)
  | ({ kind: "seat_offer" } & SeatOffersOutcome)
  | ({ kind: "trip_rescheduled" } & RescheduleNoticeOutcome)
  | { kind: "departure_note"; outcome: SendDepartureNoteOutcome }
  | ({ kind: "counter_payment" } & CounterPaymentOutcome);

export async function holdSend(
  db: AppDb,
  input: {
    shopId: string;
    payload: HeldSendPayload;
    actorPersonId: string | null;
    now?: Date;
  },
): Promise<{ id: string; runAt: Date }> {
  const now = input.now ?? nowDate();
  const payload = heldSendPayloadSchema.parse(input.payload);
  const runAt = heldSendRunAt(payload, now);
  const [row] = await db
    .insert(heldSends)
    .values({
      shopId: input.shopId,
      kind: payload.kind,
      payload,
      actorPersonId: input.actorPersonId,
      runAt,
    })
    .returning({ id: heldSends.id });
  if (!row) throw new Error("held send was not written");
  return { id: row.id, runAt };
}

/**
 * Take the send back. True when the row was still held; false when it had
 * already left (or never existed for this shop), in which case nothing
 * changes and the caller shows what the send did.
 */
export async function undoHeldSend(
  db: AppDb,
  shopId: string,
  id: string,
  now = nowDate(),
): Promise<boolean> {
  const [row] = await db
    .select({ runAt: heldSends.runAt })
    .from(heldSends)
    .where(and(eq(heldSends.id, id), eq(heldSends.shopId, shopId)));
  if (!row || isHeldSendDue(row.runAt, now, 0)) return false;
  const deleted = await db
    .delete(heldSends)
    .where(and(eq(heldSends.id, id), eq(heldSends.shopId, shopId)))
    .returning({ id: heldSends.id });
  return deleted.length > 0;
}

/**
 * One held send that has not left yet, for a page that shows its hold
 * draining (the reschedule notice the board's move held). Null once it was
 * sent, undone, or never this shop's.
 */
export async function pendingHeldSend(
  db: AppDb,
  shopId: string,
  id: string,
): Promise<HeldSendRow | null> {
  const [row] = await db
    .select()
    .from(heldSends)
    .where(and(eq(heldSends.id, id), eq(heldSends.shopId, shopId)));
  return row ? toRow(row) : null;
}

export type HeldSendClaim =
  | { status: "claimed"; row: HeldSendRow }
  | { status: "pending" | "gone" };

/**
 * Claim one held send to execute it. `pending` while the hold is still
 * draining; `gone` when it was undone or another claimant already took it.
 *
 * `early` is the actor's own release: the person who held the send counted
 * the eight seconds down on their own screen and asked for it, and that ask
 * is the clock — releasing their own send a moment sooner is a thing they
 * could have done by not holding it. The server's clock still decides for
 * the cron sweep (`claimDueHeldSends`), which is what sends a hold whose tab
 * closed. Without `early`, a frozen or skewed server clock would answer
 * `pending` to every ask and the send would never leave from the page.
 */
export async function claimHeldSend(
  db: AppDb,
  shopId: string,
  id: string,
  now = nowDate(),
  options: { early?: boolean } = {},
): Promise<HeldSendClaim> {
  const [row] = await db
    .select()
    .from(heldSends)
    .where(and(eq(heldSends.id, id), eq(heldSends.shopId, shopId)));
  if (!row) return { status: "gone" };
  if (!options.early && !isHeldSendDue(row.runAt, now)) return { status: "pending" };
  const [claimed] = await db
    .delete(heldSends)
    .where(and(eq(heldSends.id, id), eq(heldSends.shopId, shopId)))
    .returning();
  if (!claimed) return { status: "gone" };
  const readable = toRow(claimed);
  return readable ? { status: "claimed", row: readable } : { status: "gone" };
}

/**
 * Every held send whose hold has drained, claimed for the cron sweep. A row
 * this release cannot read (a payload the release before it held, such as a
 * `waitlist_invite`) is claimed and dropped on its own, logged, and never
 * costs the other due rows their send (security review of #2656, minor 2):
 * the claim deletes every due row, so one throw here would lose them all.
 */
export async function claimDueHeldSends(db: AppDb, now = nowDate()): Promise<HeldSendRow[]> {
  const rows = await db.delete(heldSends).where(lte(heldSends.runAt, now)).returning();
  return rows.flatMap((row) => toRow(row) ?? []);
}

/** The row as this release reads it, or null (logged) for a payload it cannot read. */
function toRow(row: typeof heldSends.$inferSelect): HeldSendRow | null {
  const parsed = heldSendPayloadSchema.safeParse(row.payload);
  if (!parsed.success) {
    // The kind column, never the payload: it names people and bookings.
    log("held_send.unreadable", "error", { kind: row.kind });
    return null;
  }
  const payload = parsed.data;
  return {
    id: row.id,
    shopId: row.shopId,
    kind: payload.kind,
    payload,
    actorPersonId: row.actorPersonId,
    runAt: row.runAt,
  };
}

/** The send itself, on whichever path claimed it. */
export async function executeHeldSend(db: AppDb, row: HeldSendRow): Promise<HeldSendOutcome> {
  const { payload } = row;
  switch (payload.kind) {
    case "waiver_send": {
      const outcome = await deliverWaiverBatch(db, row.shopId, {
        bookingIds: payload.bookingIds,
        personId: payload.personId,
        channel: payload.channel,
      });
      return { kind: "waiver_send", ...outcome };
    }
    // Checked again inside: a departure cancelled or sailed during the hold
    // is refused here and nobody is messaged (`sendDepartureNote`).
    case "departure_note": {
      const outcome = await sendDepartureNote(db, {
        shopId: row.shopId,
        tripId: payload.tripId,
        body: payload.body,
        actorPersonId: row.actorPersonId,
      });
      return { kind: "departure_note", outcome };
    }
    case "seat_offer": {
      const { offerSeats } = await import("./interest-offers");
      const outcome = await offerSeats(db, {
        shopId: row.shopId,
        shopSlug: await shopSlugOf(db, row.shopId),
        tripId: payload.tripId,
        interestIds: payload.interestIds,
        discount: payload.discount,
        createdByPersonId: row.actorPersonId ?? undefined,
      });
      return { kind: "seat_offer", ...outcome };
    }
    // Money, not a message (issue #3030): the order's balance is recorded
    // only now, and the writers refuse an order no longer open.
    case "counter_payment": {
      const { recordHeldCounterPayment } = await import("./counter-payment-hold");
      const outcome = await recordHeldCounterPayment(db, {
        shopId: row.shopId,
        actorPersonId: row.actorPersonId,
        payload,
      });
      return { kind: "counter_payment", ...outcome };
    }
    case "trip_rescheduled": {
      // Imported at call time: `trip-rescheduled` holds through this module.
      const { sendRescheduleNotices } = await import("./trip-rescheduled");
      const outcome = await sendRescheduleNotices(db, row.shopId, payload);
      return { kind: "trip_rescheduled", ...outcome };
    }
  }
}

async function shopSlugOf(db: AppDb, shopId: string): Promise<string> {
  const { getShopById } = await import("./shops");
  const shop = await getShopById(db, shopId);
  if (!shop) throw new Error("held send names a shop that is gone");
  return shop.slug;
}

/**
 * The cron sweep: every held send whose client never came back (a closed
 * tab, a dropped connection) leaves on the next tick. Failures are counted,
 * never rethrown, so one broken send cannot hold the rest.
 */
export async function drainHeldSends(
  db: AppDb,
  now = nowDate(),
): Promise<{ sent: number; failed: number }> {
  const summary = { sent: 0, failed: 0 };
  for (const row of await claimDueHeldSends(db, now)) {
    try {
      await executeHeldSend(db, row);
      summary.sent += 1;
    } catch (error) {
      summary.failed += 1;
      // The error's name, not its message: a provider or driver message can
      // quote the recipient or a bound parameter.
      log("held_send.failed", "error", {
        kind: row.kind,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
    }
  }
  return summary;
}
