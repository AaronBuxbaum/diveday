import { and, eq, lte } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  type HeldSendKind,
  type HeldSendPayload,
  heldSendPayloadSchema,
  heldSendRunAt,
  isHeldSendDue,
} from "@/lib/held-sends";
import type { AppDb } from "./client";
import { heldSends } from "./schema";
import { type SendLastMinuteDealOutcome, sendLastMinuteDealBlast } from "./trip-promos";
import { inviteWaitlistDiver } from "./waitlist";
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
  | { kind: "last_minute_deal"; outcome: SendLastMinuteDealOutcome }
  | { kind: "waitlist_invite"; result: "sent" | "fallback" };

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
  return { status: "claimed", row: toRow(claimed) };
}

/** Every held send whose hold has drained, claimed for the cron sweep. */
export async function claimDueHeldSends(db: AppDb, now = nowDate()): Promise<HeldSendRow[]> {
  const rows = await db.delete(heldSends).where(lte(heldSends.runAt, now)).returning();
  return rows.map(toRow);
}

function toRow(row: typeof heldSends.$inferSelect): HeldSendRow {
  return {
    id: row.id,
    shopId: row.shopId,
    kind: row.kind,
    payload: heldSendPayloadSchema.parse(row.payload),
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
    case "last_minute_deal": {
      const outcome = await sendLastMinuteDealBlast(db, {
        shopId: row.shopId,
        shopSlug: await shopSlugOf(db, row.shopId),
        tripId: payload.tripId,
        discountPercent: payload.discountPercent,
        createdByPersonId: row.actorPersonId ?? undefined,
        recipientPersonIds: payload.recipientPersonIds,
      });
      return { kind: "last_minute_deal", outcome };
    }
    case "waitlist_invite": {
      const result = await inviteWaitlistDiver(db, {
        shopId: row.shopId,
        shopSlug: await shopSlugOf(db, row.shopId),
        entryId: payload.entryId,
      });
      return {
        kind: "waitlist_invite",
        result: result.ok && result.delivery === "sent" ? "sent" : "fallback",
      };
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
      console.error("Held send failed", {
        kind: row.kind,
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }
  return summary;
}
