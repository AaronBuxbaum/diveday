import { and, eq, gt, isNotNull, isNull, ne } from "drizzle-orm";
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
 * Returns `true` when this delivery may proceed to a handler — either the
 * event id has never been seen, or its previous delivery failed and gave the
 * claim back — and `false` on every replay of a still-claimed event (the
 * caller should treat the delivery as already handled and return success
 * without doing anything else).
 *
 * An upsert against the primary key whose `DO UPDATE` only fires on a row with
 * no live claim, so a replay of a claimed event updates nothing and returns no
 * row. Two concurrent deliveries of the same released event serialize on the
 * row: the loser re-evaluates the `setWhere` against the winner's committed
 * claim and comes back empty. The unique-violation catch stays for the same
 * CR-008 reason other claim-style inserts here keep it (e.g. `src/db/divers.ts`).
 *
 * `occurredAt` is written on insert and never rewritten — a redelivery carries
 * the same event id and therefore the same Stripe `created`, and the stored
 * value is the chronological evidence `hasNewerAccountUpdate` reads.
 */
export async function claimStripeWebhookEvent(
  db: AppDb,
  input: ClaimStripeWebhookEventInput,
): Promise<boolean> {
  const now = nowDate();
  try {
    const [row] = await db
      .insert(stripeWebhookEvents)
      .values({
        id: input.id,
        type: input.type,
        account: input.account,
        occurredAt: input.occurredAt,
        receivedAt: now,
        claimedAt: now,
      })
      .onConflictDoUpdate({
        target: stripeWebhookEvents.id,
        set: { claimedAt: now, receivedAt: now },
        setWhere: isNull(stripeWebhookEvents.claimedAt),
      })
      .returning({ id: stripeWebhookEvents.id });
    return !!row;
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return false;
    throw error;
  }
}

/**
 * Give a claim back, so a redelivery of the same event id is handled rather
 * than dropped as a duplicate. **The ledger row itself stays.**
 *
 * The claim is its own committed statement, taken *before* the handler runs
 * and independent of it. Without a release, a handler that throws left the
 * claim standing: Stripe (at-least-once) redelivers, `claimStripeWebhookEvent`
 * returns `false`, the route answers 200, and the event is marked delivered
 * having never been handled — for `invoice.paid`, `invoice.voided` and
 * `account.application.deauthorized` there is no other self-heal, so the order
 * silently never goes paid (PAY-M1).
 *
 * Releasing **nulls `claimed_at`** rather than deleting the row, because the
 * row also carries `occurred_at`, the only evidence that an event of this age
 * was ever delivered for this account. Deleting it made a *different*,
 * chronologically older `account.updated` read as fresh — a failed
 * `charges_enabled: false` erased its own evidence, so a stale
 * `charges_enabled: true` retry then applied and left the shop able to take
 * payments Stripe had actually disabled. Fail-open, on the flag
 * `canAcceptPayments` gates order and checkout creation with.
 *
 * Only ever called on the **failure** path. A successfully handled event keeps
 * its claim forever, which is the ledger's actual invariant: a replay of a
 * handled event must never reach a handler again, even when a human has since
 * made a legitimate change (a manual refund) that a re-run would undo — see
 * `webhook-events.test.ts`.
 *
 * Returns whether a live claim was actually given back. `false` means there
 * was nothing to release (no such event, or already released), which is not an
 * error.
 */
export async function releaseStripeWebhookEventClaim(db: AppDb, eventId: string): Promise<boolean> {
  const [row] = await db
    .update(stripeWebhookEvents)
    .set({ claimedAt: null })
    .where(and(eq(stripeWebhookEvents.id, eventId), isNotNull(stripeWebhookEvents.claimedAt)))
    .returning({ id: stripeWebhookEvents.id });
  return !!row;
}

/**
 * True when a chronologically newer `account.updated` event for this
 * connected account has already been delivered — the defense against
 * `account.updated`'s otherwise pure last-write-wins update (security review
 * finding): two deliveries of *different* events can arrive in either order,
 * and only Stripe's own `created` timestamp on each event (not the order we
 * happened to receive them in) says which one actually happened later.
 * Excludes `eventId` itself so this can run after the current event has
 * already been claimed by `claimStripeWebhookEvent`.
 *
 * Deliberately blind to `claimed_at`: a newer event whose handling *failed*
 * is still proof that Stripe reported something newer than the event being
 * considered, and the older one must not be applied over it. That is precisely
 * why a released claim keeps its row.
 *
 * **`account` here is the id off the event body** (`event.data.object.id`), so
 * the claim must store the same one — see `claimAccountId` in
 * `src/app/api/webhooks/stripe/route.ts`. Keying the writer on
 * `event.account` alone would leave every delivery without a top-level
 * `account` stored as `null`, matching nothing here, and this whole defense
 * would degrade to last-write-wins without a single test failing.
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
