/**
 * Retention windows for the append-only tables that otherwise grow forever
 * (DATA-M4/PAY-L2, ADR 20260803-append-only-retention).
 *
 * Framework-free on purpose: this file is nothing but the numbers, the reason
 * for each number, and the arithmetic that turns them into cutoffs. The
 * deletion itself lives in `src/db/retention.ts`; the schedule lives in
 * `src/app/api/cron/retention/route.ts` and `vercel.json`.
 *
 * **The values below are HD-11's decision, not an agent's.** HD-11 owns the
 * retention half of the erasure-versus-signed-evidence question, and nothing
 * here has been through counsel. What is written here is a set of deliberately
 * *conservative* defaults — long enough that no plausible investigation,
 * dispute, or provider retry loses evidence it needed, at the cost of keeping
 * rows longer than a minimal-retention posture would. Shortening any of them
 * is a policy change: edit this one table, say so in the ADR, and nothing else
 * in the codebase has to move.
 */

/**
 * How long Stripe itself keeps retrying a webhook delivery in live mode
 * (Stripe retries with exponential backoff for up to three days). Named here
 * because {@link RETENTION_DAYS}'s `stripe_webhook_events` window has to sit
 * *comfortably* above it and the reason must not be a comment somebody can
 * edit away — `retentionWindowsOutlastStripeRetries` asserts the relationship
 * and a unit test holds it.
 */
export const STRIPE_WEBHOOK_RETRY_DAYS = 3;

/**
 * The tables this mechanism prunes. Adding one here is a deliberate act: it
 * needs a window below and a delete arm in `src/db/retention.ts`, and both
 * are code review surface.
 */
export type RetainedTable =
  | "stripe_webhook_events"
  | "notification_delivery_attempts"
  | "activity_events"
  | "account_tokens"
  | "booking_payment_events"
  | "push_subscriptions";

/**
 * The one place a human changes how long each trail is kept, in days.
 *
 * Every window is measured from the row's own event time, not from when it was
 * written — see `src/db/retention.ts` for which column each arm uses.
 */
export const RETENTION_DAYS: Readonly<Record<RetainedTable, number>> = {
  /**
   * 400 days. This one is **not** a convenience window. A
   * `stripe_webhook_events` row does two jobs (see its schema docblock): it is
   * the dedup claim, and it is the chronological evidence
   * `hasNewerAccountUpdate` reads to refuse a stale `account.updated`. Pruning
   * a row inside Stripe's own retry window would let an older redelivery read
   * as fresh and regress `charges_enabled` — fail-open on the flag that gates
   * order and checkout creation. 400 days is ~133× {@link
   * STRIPE_WEBHOOK_RETRY_DAYS}, covers a full year of "what did Stripe tell us
   * about this account?" plus an annual-review margin, and is the longest
   * window here for a table that holds no diver data at all (event ids, types,
   * connected-account ids, timestamps).
   */
  stripe_webhook_events: 400,
  /**
   * 400 days. The durable proof that a shop did (or did not) reach a diver —
   * the record a "you never told me the trip was cancelled" conversation turns
   * on. A season plus a full year, so last year's incident is still answerable
   * during this year's same week. Carries provider message ids and error
   * codes, not message bodies.
   */
  notification_delivery_attempts: 400,
  /**
   * 1095 days (3 years). Staff-facing operational history in human language:
   * who moved a booking, who cancelled a departure. Longest-lived because it
   * is the narrative a shop reconstructs an old season from, and it is small
   * (one short row per operational act).
   */
  activity_events: 1095,
  /**
   * 90 days **past each token's own expiry**, not past its creation. These are
   * hashed bearer credentials over account takeover, so the conservative
   * direction here is the opposite of the tables above: keep them long enough
   * to answer "was this reset link ever issued/used?" during an incident
   * review, and no longer. Only already-expired rows are ever eligible — a
   * live token is never pruned regardless of age.
   */
  account_tokens: 90,
  /**
   * 2555 days (7 years). The local money ledger DATA-M3 exists to provide;
   * matched to the ordinary financial-records horizon rather than to anything
   * operational, because the whole point of the table is that it outlives the
   * mutable `booking_payments` row it records. Listed here rather than left
   * unbounded so that "how long is a shop's money history kept?" has an answer
   * in the same table as every other trail.
   */
  booking_payment_events: 2555,
  /**
   * 30 days. The shortest window here, and deliberately so: a
   * `push_subscriptions` row is a *device credential* (endpoint plus the two
   * keys a push is encrypted to), not a record anyone needs later. It is useful
   * only while its trip is near departure, so a row a month past its creation
   * has no remaining purpose and is pure blast radius if the database is ever
   * disclosed.
   *
   * The common cases are already handled elsewhere and this is the backstop for
   * what they miss: the trip's ON DELETE CASCADE clears rows when a departure is
   * deleted, a 404/410 from the push service prunes retired endpoints on sight,
   * and `removeStaffMember` revokes a leaver's devices. None of those fire for a
   * device that simply stopped being used.
   */
  push_subscriptions: 30,
};

/**
 * The most rows one prune pass may delete per table. A bound, not a target:
 * the pass runs daily, so a table that is over its window by more than this
 * simply converges over a few ticks instead of trying to delete a decade of
 * backlog inside one function invocation's time limit. Raising it trades
 * convergence speed for the risk of a run that outlives the platform's
 * function ceiling and is killed halfway.
 */
export const PRUNE_BATCH_LIMIT = 5_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant before which rows of `table` are eligible for deletion. */
export function retentionCutoff(table: RetainedTable, now: Date): Date {
  return new Date(now.getTime() - RETENTION_DAYS[table] * DAY_MS);
}

/**
 * True when the Stripe webhook window still outlasts Stripe's own retry
 * window by the stated safety factor. The review that raised PAY-L2 named this
 * exact hazard, so it is asserted rather than commented: shortening
 * `stripe_webhook_events` below it must fail a test, not a code review.
 */
export function retentionWindowsOutlastStripeRetries(safetyFactor = 10): boolean {
  return RETENTION_DAYS.stripe_webhook_events >= STRIPE_WEBHOOK_RETRY_DAYS * safetyFactor;
}
