import { and, eq, gt, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppDb } from "./client";
import { isUniqueConstraintViolation } from "./client";
import { stripeWebhookEvents } from "./schema";

export type ClaimStripeWebhookEventInput = {
  /** Stripe's own event id (`evt_...`) — globally unique. */
  id: string;
  type: string;
  /** The connected account the event happened on; null for platform-only events. */
  account: string | null;
  /** Stripe's own event-creation time, not when we received it. */
  occurredAt: Date;
};

/**
 * Claims a Stripe webhook event by its own globally-unique id, so a
 * redelivered event is handled at most once independent of each handler's
 * own idempotent state machine — belt-and-suspenders, not a replacement
 * (docs ADR 20260719-stripe-connect-orders; security review finding).
 *
 * Returns `true` the first time this event id is seen (the caller should go
 * on to run its normal handling) and `false` on every replay (the caller
 * should treat the delivery as already handled and return success without
 * doing anything else). An `onConflictDoNothing` insert against the primary
 * key, with a unique-violation catch for the race where two deliveries of
 * the same event land concurrently (the same CR-008 pattern other claim-style
 * inserts in this codebase use, e.g. `src/db/divers.ts`).
 */
export async function claimStripeWebhookEvent(
  db: AppDb,
  input: ClaimStripeWebhookEventInput,
): Promise<boolean> {
  try {
    const [row] = await db
      .insert(stripeWebhookEvents)
      .values({
        id: input.id,
        type: input.type,
        account: input.account,
        occurredAt: input.occurredAt,
        receivedAt: nowDate(),
      })
      .onConflictDoNothing()
      .returning({ id: stripeWebhookEvents.id });
    return !!row;
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return false;
    throw error;
  }
}

/**
 * Give a claim back, so a redelivery of the same event id is handled rather
 * than dropped as a duplicate.
 *
 * The claim is its own committed statement, taken *before* the handler runs
 * and independent of it. Without this, a handler that throws left the row
 * behind: Stripe (at-least-once) redelivers, `claimStripeWebhookEvent` returns
 * `false`, the route answers 200, and the event is marked delivered having
 * never been handled — for `invoice.paid`, `invoice.voided` and
 * `account.application.deauthorized` there is no other self-heal, so the order
 * silently never goes paid (PAY-M1).
 *
 * Only ever called on the **failure** path. A successfully handled event keeps
 * its claim forever, which is the ledger's actual invariant: a replay of a
 * handled event must never reach a handler again, even when a human has since
 * made a legitimate change (a manual refund) that a re-run would undo — see
 * `webhook-events.test.ts`.
 *
 * Returns whether a row was actually removed. `false` means there was nothing
 * to release (already gone), which is not an error.
 */
export async function releaseStripeWebhookEventClaim(db: AppDb, eventId: string): Promise<boolean> {
  const [row] = await db
    .delete(stripeWebhookEvents)
    .where(eq(stripeWebhookEvents.id, eventId))
    .returning({ id: stripeWebhookEvents.id });
  return !!row;
}

/**
 * True when a chronologically newer `account.updated` event for this
 * connected account has already been claimed in the ledger — the defense
 * against `account.updated`'s otherwise pure last-write-wins update
 * (security review finding): two deliveries of *different* events can arrive
 * in either order, and only Stripe's own `created` timestamp on each event
 * (not the order we happened to receive them in) says which one actually
 * happened later. Excludes `eventId` itself so this can run after the
 * current event has already been claimed by `claimStripeWebhookEvent`.
 */
export async function hasNewerAccountUpdate(
  db: AppDb,
  account: string,
  eventId: string,
  occurredAt: Date,
): Promise<boolean> {
  const [newer] = await db
    .select({ id: stripeWebhookEvents.id })
    .from(stripeWebhookEvents)
    .where(
      and(
        eq(stripeWebhookEvents.type, "account.updated"),
        eq(stripeWebhookEvents.account, account),
        ne(stripeWebhookEvents.id, eventId),
        gt(stripeWebhookEvents.occurredAt, occurredAt),
      ),
    )
    .limit(1);
  return !!newer;
}
