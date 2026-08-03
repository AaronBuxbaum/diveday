import { inArray, lt } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import {
  PRUNE_BATCH_LIMIT,
  RETENTION_DAYS,
  type RetainedTable,
  retentionCutoff,
} from "@/lib/retention";
import type { AppDb } from "./client";
import {
  accountTokens,
  activityEvents,
  bookingPaymentEvents,
  notificationDeliveryAttempts,
  stripeWebhookEvents,
} from "./schema";

/**
 * Delete rows past their retention window from the append-only tables that
 * otherwise grow without bound (DATA-M4/PAY-L2, ADR
 * 20260803-append-only-retention).
 *
 * The windows themselves are in `src/lib/retention.ts` — one table, one place a
 * human edits, and **their values are HD-11's decision, not this module's**.
 * This file only knows *which column* each window is measured against and how
 * to delete safely.
 *
 * Every arm is:
 *
 * - **Bounded.** At most {@link PRUNE_BATCH_LIMIT} rows per table per pass, so
 *   one run can never outlive the platform's function ceiling. A backlog
 *   converges over successive daily ticks instead of failing forever.
 * - **Independent.** One arm throwing does not starve the rest; it is reported
 *   with its own table code and the pass carries on, the same shape the daily
 *   reminders tick uses for its scans.
 * - **Age-based only.** No arm ever consults state a human could still be
 *   acting on. The only conditional arm is `account_tokens`, which measures
 *   from each token's own `expires_at` so a live credential is never eligible
 *   at any age.
 */
export type PruneOutcome = {
  table: RetainedTable;
  /** Rows actually deleted this pass. */
  deleted: number;
  /** True when the batch cap was hit, i.e. more rows are still eligible. */
  capped: boolean;
  /** True when this arm threw; `deleted` is then 0 and means nothing. */
  failed: boolean;
  /** The window applied, echoed so a report never has to re-derive it. */
  retentionDays: number;
};

export type PruneSummary = {
  outcomes: PruneOutcome[];
  totalDeleted: number;
  failedTables: RetainedTable[];
};

/**
 * Deletes at most `PRUNE_BATCH_LIMIT` rows in two statements — select the
 * eligible ids, then delete exactly those — rather than one `DELETE ... LIMIT`,
 * which Postgres does not support and which a subquery would only emulate.
 * Two statements are also what makes the count returned here the count actually
 * deleted rather than an estimate.
 */
async function pruneBatch<Id extends string>(
  table: RetainedTable,
  selectIds: () => Promise<Array<{ id: Id }>>,
  deleteIds: (ids: Id[]) => Promise<unknown>,
): Promise<PruneOutcome> {
  const retentionDays = RETENTION_DAYS[table];
  try {
    const rows = await selectIds();
    if (rows.length === 0) {
      return { table, deleted: 0, capped: false, failed: false, retentionDays };
    }
    await deleteIds(rows.map((row) => row.id));
    return {
      table,
      deleted: rows.length,
      capped: rows.length >= PRUNE_BATCH_LIMIT,
      failed: false,
      retentionDays,
    };
  } catch {
    // Codes, not sentences, and no row contents: this module is one table over
    // from medical and payment data, so the log line carries the table code and
    // nothing else. The throw is re-reported by the caller (Sentry, in the cron
    // route) with the same tag.
    log("retention.prune_failed", "error", { table });
    return { table, deleted: 0, capped: false, failed: true, retentionDays };
  }
}

/**
 * One prune pass over every retained table. Safe to run repeatedly and safe to
 * run concurrently with itself: each arm deletes only rows it has just
 * observed to be past the window, so a second pass simply finds fewer.
 *
 * `now` defaults through `nowDate()` — the repo's one clock seam — so the e2e
 * fleet's frozen instant reaches this the same way it reaches every other scan.
 */
export async function pruneExpiredRecords(
  db: AppDb,
  opts: { now?: Date } = {},
): Promise<PruneSummary> {
  const now = opts.now ?? nowDate();
  const cutoff = (table: RetainedTable) => retentionCutoff(table, now);

  const outcomes: PruneOutcome[] = [];

  // Stripe's own ledger. `occurred_at` (Stripe's event-creation time), not
  // `received_at`: the window's whole purpose is to outlast Stripe's retry
  // horizon, which is measured from when the event happened.
  outcomes.push(
    await pruneBatch(
      "stripe_webhook_events",
      () =>
        db
          .select({ id: stripeWebhookEvents.id })
          .from(stripeWebhookEvents)
          .where(lt(stripeWebhookEvents.occurredAt, cutoff("stripe_webhook_events")))
          .limit(PRUNE_BATCH_LIMIT),
      (ids) => db.delete(stripeWebhookEvents).where(inArray(stripeWebhookEvents.id, ids)),
    ),
  );

  // Measured from the attempt, not from the row's insert — a retry queued long
  // after the original send is its own row with its own `attempted_at`.
  outcomes.push(
    await pruneBatch(
      "notification_delivery_attempts",
      () =>
        db
          .select({ id: notificationDeliveryAttempts.id })
          .from(notificationDeliveryAttempts)
          .where(
            lt(notificationDeliveryAttempts.attemptedAt, cutoff("notification_delivery_attempts")),
          )
          .limit(PRUNE_BATCH_LIMIT),
      (ids) =>
        db
          .delete(notificationDeliveryAttempts)
          .where(inArray(notificationDeliveryAttempts.id, ids)),
    ),
  );

  outcomes.push(
    await pruneBatch(
      "activity_events",
      () =>
        db
          .select({ id: activityEvents.id })
          .from(activityEvents)
          .where(lt(activityEvents.occurredAt, cutoff("activity_events")))
          .limit(PRUNE_BATCH_LIMIT),
      (ids) => db.delete(activityEvents).where(inArray(activityEvents.id, ids)),
    ),
  );

  // The one arm measured from a column that is not "when it happened":
  // `expires_at` is when the credential stopped being usable, so the window is
  // "90 days after it went dead", and a token still live at any age is never
  // eligible. A used or superseded token still carries its original
  // `expires_at`, so it ages out on the same clock.
  outcomes.push(
    await pruneBatch(
      "account_tokens",
      () =>
        db
          .select({ id: accountTokens.id })
          .from(accountTokens)
          .where(lt(accountTokens.expiresAt, cutoff("account_tokens")))
          .limit(PRUNE_BATCH_LIMIT),
      (ids) => db.delete(accountTokens).where(inArray(accountTokens.id, ids)),
    ),
  );

  // The local money ledger (DATA-M3). Longest window here by a wide margin;
  // pruned at all only so that "how long is a shop's money history kept?" has
  // a stated answer rather than an implicit "forever".
  outcomes.push(
    await pruneBatch(
      "booking_payment_events",
      () =>
        db
          .select({ id: bookingPaymentEvents.id })
          .from(bookingPaymentEvents)
          .where(lt(bookingPaymentEvents.occurredAt, cutoff("booking_payment_events")))
          .limit(PRUNE_BATCH_LIMIT),
      (ids) => db.delete(bookingPaymentEvents).where(inArray(bookingPaymentEvents.id, ids)),
    ),
  );

  return {
    outcomes,
    totalDeleted: outcomes.reduce((sum, outcome) => sum + outcome.deleted, 0),
    failedTables: outcomes.filter((outcome) => outcome.failed).map((outcome) => outcome.table),
  };
}
