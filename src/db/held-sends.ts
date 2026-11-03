import { and, asc, eq, isNotNull, lt, lte, type SQL, sql } from "drizzle-orm";
import { nowDate, nowMs } from "@/lib/clock";
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
import { heldSendValues } from "./held-send-rows";
import type { SeatOffersOutcome } from "./interest-offers";
import { notificationSendQueue } from "./schema";
import type { RescheduleNoticeOutcome } from "./trip-rescheduled";
import { deliverWaiverBatch, type WaiverBatchOutcome } from "./waiver-issue";

/**
 * The held sends (ADR 20260906-before-you-ask, decision 2), kept as rows of
 * the one send queue, `notification_send_queue` (issue #2730).
 *
 * A held row is a send that has been tapped and not yet left: `intent` holds
 * its ids-only payload and `next_attempt_at` is when the hold drains. Undo
 * **deletes** it while it is still `queued` and not yet due. A claim moves it
 * `queued` → `processing` in one compare-and-swap, so the client that counted
 * down and the drain that sweeps a closed tab can both try and exactly one of
 * them sends. The send settles it `sent` or `failed` and nulls its intent and
 * actor, so a settled row holds no ids and the queue's 90-day prune takes it.
 *
 * **At most once.** A held send may write to many divers (a waiver batch, a
 * seat offer to a list), so one that died mid-way may have reached some of
 * them. It is never put back to `queued`: a lapsed `processing` claim settles
 * `failed` with `held_send_interrupted`, which is what deleting the row at the
 * claim used to guarantee.
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

/**
 * How long a claimed held send may run before the drain calls it
 * interrupted. Generous: a seat offer to a long list sends one mail at a time,
 * and calling a live send interrupted would only mislabel it (the drain never
 * re-sends a held row either way).
 */
export const HELD_SEND_CLAIM_MS = 15 * 60_000;

/** A held row of this shop, and only a held row: a sealed retry is never one. */
function heldRowOf(shopId: string, id: string) {
  return and(
    eq(notificationSendQueue.id, id),
    eq(notificationSendQueue.shopId, shopId),
    isNotNull(notificationSendQueue.intent),
  );
}

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
    .insert(notificationSendQueue)
    .values(
      heldSendValues({ shopId: input.shopId, payload, actorPersonId: input.actorPersonId, runAt }),
    )
    .returning({ id: notificationSendQueue.id });
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
    .select({ runAt: notificationSendQueue.nextAttemptAt, status: notificationSendQueue.status })
    .from(notificationSendQueue)
    .where(heldRowOf(shopId, id));
  if (!row || row.status !== "queued" || isHeldSendDue(row.runAt, now, 0)) return false;
  // `queued` again in the delete itself: a claim that landed between the read
  // and this line has already started the send, and Undo must not pretend.
  const deleted = await db
    .delete(notificationSendQueue)
    .where(and(heldRowOf(shopId, id), eq(notificationSendQueue.status, "queued")))
    .returning({ id: notificationSendQueue.id });
  return deleted.length > 0;
}

/**
 * One held send that has not left yet, for a page that shows its hold
 * draining (the reschedule notice the board's move held). Null once it was
 * claimed, sent, undone, or never this shop's.
 */
export async function pendingHeldSend(
  db: AppDb,
  shopId: string,
  id: string,
): Promise<HeldSendRow | null> {
  const [row] = await db
    .select()
    .from(notificationSendQueue)
    .where(and(heldRowOf(shopId, id), eq(notificationSendQueue.status, "queued")));
  return row ? toRow(row) : null;
}

export type HeldSendClaim =
  | { status: "claimed"; row: HeldSendRow }
  | { status: "pending" | "gone" };

/** The one compare-and-swap that starts a held send: `queued` → `processing`. */
async function claimRow(db: AppDb, where: SQL | undefined) {
  return db
    .update(notificationSendQueue)
    .set({
      status: "processing",
      attempts: sql`${notificationSendQueue.attempts} + 1`,
      lockedUntil: new Date(nowMs() + HELD_SEND_CLAIM_MS),
      updatedAt: nowDate(),
    })
    .where(and(where, eq(notificationSendQueue.status, "queued")))
    .returning();
}

/**
 * Claim one held send to execute it. `pending` while the hold is still
 * draining; `gone` when it was undone or another claimant already took it.
 *
 * `early` is the actor's own release: the person who held the send counted
 * the eight seconds down on their own screen and asked for it, and that ask
 * is the clock — releasing their own send a moment sooner is a thing they
 * could have done by not holding it. The server's clock still decides for
 * the drain's sweep, which is what sends a hold whose tab closed. Without
 * `early`, a frozen or skewed server clock would answer `pending` to every ask
 * and the send would never leave from the page.
 */
export async function claimHeldSend(
  db: AppDb,
  shopId: string,
  id: string,
  now = nowDate(),
  options: { early?: boolean } = {},
): Promise<HeldSendClaim> {
  const [row] = await db
    .select({ runAt: notificationSendQueue.nextAttemptAt, status: notificationSendQueue.status })
    .from(notificationSendQueue)
    .where(heldRowOf(shopId, id));
  if (!row || row.status !== "queued") return { status: "gone" };
  if (!options.early && !isHeldSendDue(row.runAt, now)) return { status: "pending" };
  const [claimed] = await claimRow(db, heldRowOf(shopId, id));
  if (!claimed) return { status: "gone" };
  const readable = toRow(claimed);
  if (readable) return { status: "claimed", row: readable };
  await settleHeldSend(db, claimed.id, "failed", "held_intent_unreadable");
  return { status: "gone" };
}

/**
 * The drain's sweep of held rows (`drainNotificationRetries`): settle every
 * claim that lapsed as interrupted, then claim every held row whose hold has
 * drained. Each row is claimed by its own compare-and-swap, so a client
 * releasing the same row at the same moment sends it or this does, never both.
 */
export async function claimDueHeldSends(db: AppDb, now = nowDate()): Promise<HeldSendRow[]> {
  await settleInterruptedHeldSends(db, now);
  const claimed: HeldSendRow[] = [];
  for (const { id } of await dueHeldIds(db, now)) {
    const [row] = await claimRow(
      db,
      and(eq(notificationSendQueue.id, id), isNotNull(notificationSendQueue.intent)),
    );
    if (!row) continue;
    const readable = toRow(row);
    if (readable) claimed.push(readable);
    // A payload this release cannot read (one the release before it held) is
    // settled on its own and never costs the other due rows their send
    // (security review of #2656, minor 2).
    else await settleHeldSend(db, row.id, "failed", "held_intent_unreadable");
  }
  return claimed;
}

/** Every held row of every shop whose hold has drained, oldest first. */
function dueHeldIds(db: AppDb, now: Date) {
  return db
    .select({ id: notificationSendQueue.id })
    .from(notificationSendQueue)
    .where(
      and(
        isNotNull(notificationSendQueue.intent),
        eq(notificationSendQueue.status, "queued"),
        lte(notificationSendQueue.nextAttemptAt, now),
      ),
    )
    .orderBy(asc(notificationSendQueue.nextAttemptAt));
}

/** A claim whose lock lapsed died mid-send. It may have reached some divers, so it is not sent again. */
async function settleInterruptedHeldSends(db: AppDb, now: Date): Promise<void> {
  const lapsed = await db
    .update(notificationSendQueue)
    .set({
      status: "failed",
      intent: null,
      actorPersonId: null,
      lockedUntil: null,
      errorCode: "held_send_interrupted",
      updatedAt: nowDate(),
    })
    .where(
      and(
        isNotNull(notificationSendQueue.intent),
        eq(notificationSendQueue.status, "processing"),
        lt(notificationSendQueue.lockedUntil, now),
      ),
    )
    .returning({ id: notificationSendQueue.id });
  if (lapsed.length > 0) log("held_send.interrupted", "error", { count: lapsed.length });
}

/** The row's last write: settled, with no ids left on it. */
async function settleHeldSend(
  db: AppDb,
  id: string,
  status: "sent" | "failed",
  errorCode: string | null = null,
): Promise<void> {
  await db
    .update(notificationSendQueue)
    .set({
      status,
      intent: null,
      actorPersonId: null,
      lockedUntil: null,
      errorCode,
      updatedAt: nowDate(),
    })
    .where(and(eq(notificationSendQueue.id, id), eq(notificationSendQueue.status, "processing")));
}

/** The row as this release reads it, or null (logged) for a payload it cannot read. */
function toRow(row: typeof notificationSendQueue.$inferSelect): HeldSendRow | null {
  const parsed = heldSendPayloadSchema.safeParse(row.intent);
  if (!parsed.success) {
    // Never the payload: it names people and bookings.
    log("held_send.unreadable", "error", {});
    return null;
  }
  const payload = parsed.data;
  return {
    id: row.id,
    shopId: row.shopId,
    kind: payload.kind,
    payload,
    actorPersonId: row.actorPersonId,
    runAt: row.nextAttemptAt,
  };
}

/**
 * The send itself, on whichever path claimed it, and the row settled after
 * it: `sent` when it returned, `failed` (and rethrown) when it threw.
 */
export async function executeHeldSend(db: AppDb, row: HeldSendRow): Promise<HeldSendOutcome> {
  let outcome: HeldSendOutcome;
  try {
    outcome = await runHeldSend(db, row);
  } catch (error) {
    await settleHeldSend(db, row.id, "failed", "held_send_failed");
    throw error;
  }
  await settleHeldSend(db, row.id, "sent");
  return outcome;
}

async function runHeldSend(db: AppDb, row: HeldSendRow): Promise<HeldSendOutcome> {
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
 * The held arm of the one queue drain (`drainNotificationRetries`): every held
 * send whose client never came back (a closed tab, a dropped connection)
 * leaves on the next pass. Failures are counted, never rethrown, so one broken
 * send cannot hold the rest.
 */
export async function drainHeldQueueRows(
  db: AppDb,
  now = nowDate(),
): Promise<{ sent: number; failed: number }> {
  const summary = { sent: 0, failed: 0 };
  await settleInterruptedHeldSends(db, now);
  // One row claimed, sent and settled before the next is claimed: a worker
  // that dies mid-pass leaves only the row it was sending interrupted, and the
  // rest still queued for the next pass (security review of #2730).
  for (const { id } of await dueHeldIds(db, now)) {
    const [claimed] = await claimRow(
      db,
      and(eq(notificationSendQueue.id, id), isNotNull(notificationSendQueue.intent)),
    );
    if (!claimed) continue;
    const row = toRow(claimed);
    if (!row) {
      await settleHeldSend(db, claimed.id, "failed", "held_intent_unreadable");
      summary.failed += 1;
      continue;
    }
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
