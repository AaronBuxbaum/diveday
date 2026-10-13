import { and, inArray, isNotNull, isNull, lt, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
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
  accountSessions,
  accountTokens,
  activityEvents,
  bookingCapabilities,
  bookingPaymentEvents,
  crewNotices,
  demoEntries,
  departureNotes,
  formDrafts,
  inboundMessages,
  integrationEvents,
  integrationOauthStates,
  lostItems,
  notificationDeliveries,
  notificationDeliveryAttempts,
  notificationSendQueue,
  pushSubscriptions,
  setupRequests,
  shopContactEmailConfirmationTokens,
  staffReplies,
  stripeWebhookEvents,
  tripDeskEvents,
  tripReadMarks,
  waiverDeliveries,
  weeklyDigestSends,
} from "./schema";

/**
 * Delete rows past their retention window from operational tables that
 * otherwise grow without bound (DATA-M4/PAY-L2, ADR
 * 20260803-append-only-retention).
 *
 * The windows themselves are in `src/lib/retention.ts` — one table, one place a
 * human edits, and **their values are HD-11's decision, not this module's**.
 * This file only knows *which column* each window is measured against and how
 * to delete safely.
 *
 * Every arm ({@link PRUNE_ARMS}) is:
 *
 * - **Bounded.** At most {@link PRUNE_BATCH_LIMIT} rows per table per pass, so
 *   one run can never outlive the platform's function ceiling. A backlog
 *   converges over successive weekly ticks (`vercel.json`, Sundays 03:30 UTC)
 *   instead of failing forever.
 * - **Independent.** One arm throwing does not starve the rest; it is reported
 *   with its own table code and the pass carries on, the same shape the daily
 *   reminders tick uses for its scans.
 * - **Age-based only.** No arm ever consults state a human could still be
 *   acting on. The token arms (`account_tokens`, `account_sessions`,
 *   `shop_contact_email_confirmation_tokens`, `booking_capabilities`) measure
 *   from each token's own `expires_at`, so a live credential is never eligible
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
async function pruneBatch(
  db: AppDb,
  table: RetainedTable,
  arm: PruneArm,
  now: Date,
): Promise<PruneOutcome> {
  const retentionDays = RETENTION_DAYS[table];
  try {
    const rows = (await db
      .select({ id: arm.id })
      .from(arm.from)
      .where(and(lt(arm.clock, retentionCutoff(table, now)), arm.extraWhere))
      .limit(PRUNE_BATCH_LIMIT)) as { id: string }[];
    if (rows.length === 0) {
      return { table, deleted: 0, capped: false, failed: false, retentionDays };
    }
    await db.delete(arm.from).where(
      inArray(
        arm.id,
        rows.map((row) => row.id),
      ),
    );
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
 * **Which column each window is measured against**, one row per retained
 * table, in the order a pass prunes them. `clock` is the instant the row's
 * window runs from; `extraWhere` is what the clock alone must not take (a send
 * still in flight, an item the shop is still holding). Every row here is
 * pruned the same way by {@link pruneBatch}, and `retention.test.ts` inserts a
 * stale and a fresh row for every key and proves the arm deletes exactly one.
 */
type PruneArm = {
  from: PgTable;
  id: PgColumn;
  clock: PgColumn;
  extraWhere?: SQL;
};

export const PRUNE_ARMS = {
  // Stripe's own ledger. `occurred_at` (Stripe's event-creation time), not
  // `received_at`: the window's whole purpose is to outlast Stripe's retry
  // horizon, which is measured from when the event happened.
  stripe_webhook_events: {
    from: stripeWebhookEvents,
    id: stripeWebhookEvents.id,
    clock: stripeWebhookEvents.occurredAt,
  },
  integration_events: {
    from: integrationEvents,
    id: integrationEvents.id,
    clock: integrationEvents.createdAt,
  },
  integration_oauth_states: {
    from: integrationOauthStates,
    id: integrationOauthStates.id,
    clock: integrationOauthStates.expiresAt,
  },
  // Measured from the attempt, not from the row's insert — a retry queued long
  // after the original send is its own row with its own `attempted_at`.
  notification_delivery_attempts: {
    from: notificationDeliveryAttempts,
    id: notificationDeliveryAttempts.id,
    clock: notificationDeliveryAttempts.attemptedAt,
  },
  // The latest delivery outcome is mutable state, but it is still an
  // operational trail: its provider detail and send error are the evidence a
  // shop reads when asking whether a message reached a diver. Measure it from
  // the latest send attempt, which is refreshed whenever a new send replaces
  // the row.
  notification_deliveries: {
    from: notificationDeliveries,
    id: notificationDeliveries.id,
    clock: notificationDeliveries.attemptedAt,
  },
  activity_events: {
    from: activityEvents,
    id: activityEvents.id,
    clock: activityEvents.occurredAt,
  },
  // The one arm measured from a column that is not "when it happened":
  // `expires_at` is when the credential stopped being usable, so the window is
  // "90 days after it went dead", and a token still live at any age is never
  // eligible. A used or superseded token still carries its original
  // `expires_at`, so it ages out on the same clock.
  account_tokens: {
    from: accountTokens,
    id: accountTokens.id,
    clock: accountTokens.expiresAt,
  },
  // Same clock as account_tokens. A session past its own `expires_at` is one the
  // auth layer already refuses; deleting it takes its IP address and user agent
  // with it, and its step-up grants cascade away.
  account_sessions: {
    from: accountSessions,
    id: accountSessions.id,
    clock: accountSessions.expiresAt,
  },
  // Same shape and same clock as account_tokens: measured from each link's
  // own `expires_at`, so a live confirmation link is never eligible.
  shop_contact_email_confirmation_tokens: {
    from: shopContactEmailConfirmationTokens,
    id: shopContactEmailConfirmationTokens.id,
    clock: shopContactEmailConfirmationTokens.expiresAt,
  },
  // Booking links (H-82, issue #1726), on the same clock as the two token
  // arms above. `expires_at` only, never `revoked_at`: a revoked link can still
  // be inside its own life, and an unexpired row is never eligible whatever
  // else is true of it.
  booking_capabilities: {
    from: bookingCapabilities,
    id: bookingCapabilities.id,
    clock: bookingCapabilities.expiresAt,
  },
  // The local money ledger (DATA-M3). Longest window here by a wide margin;
  // pruned at all only so that "how long is a shop's money history kept?" has
  // a stated answer rather than an implicit "forever".
  booking_payment_events: {
    from: bookingPaymentEvents,
    id: bookingPaymentEvents.id,
    clock: bookingPaymentEvents.occurredAt,
  },
  // Device push credentials (ADR 20260804-manifest-web-push). Pruned by
  // `created_at` rather than by the trip's departure: the row's whole value is
  // short-lived, and keying on its own age means a subscription whose trip was
  // moved, deleted, or never sailed is still bounded.
  push_subscriptions: {
    from: pushSubscriptions,
    id: pushSubscriptions.id,
    clock: pushSubscriptions.createdAt,
  },
  // The Monday email's per-week claims and their opt-out link hashes. Pruned
  // on their own age: the claim is spent once its week is over.
  weekly_digest_sends: {
    from: weeklyDigestSends,
    id: weeklyDigestSends.id,
    clock: weeklyDigestSends.createdAt,
  },
  // Crew news, spent the hour it settles (ADR 20261009-crew-hear-about-their-boats).
  crew_notices: {
    from: crewNotices,
    id: crewNotices.id,
    clock: crewNotices.createdAt,
  },
  // Finished sends only, on the instant they were finished. `sent`, or
  // `failed` with the payload already cleared: a parked
  // `sealed_payload_unreadable` row keeps its payload while the drain may still
  // offer it, so it never matches (`drainableStatus`, src/db/notifications.ts).
  // A `queued` or `processing` row is someone's work in flight and never
  // matches either.
  notification_send_queue: {
    from: notificationSendQueue,
    id: notificationSendQueue.id,
    clock: notificationSendQueue.updatedAt,
    extraWhere: and(
      inArray(notificationSendQueue.status, ["sent", "failed"]),
      isNull(notificationSendQueue.payloadSealed),
    ),
  },
  // A waiver link's latest delivery outcome, on its own latest attempt: a new
  // send replaces the row and moves `attempted_at` forward.
  waiver_deliveries: {
    from: waiverDeliveries,
    id: waiverDeliveries.id,
    clock: waiverDeliveries.attemptedAt,
  },
  // A set-up request on the day it was made; its single-use link goes with it
  // (`on delete cascade`).
  setup_requests: {
    from: setupRequests,
    id: setupRequests.id,
    clock: setupRequests.createdAt,
  },
  // Found items, only once resolved: an open one is still the shop's to hold,
  // so `resolved_at` is both the clock and the filter (batch 4, J2).
  lost_items: {
    from: lostItems,
    id: lostItems.id,
    clock: lostItems.resolvedAt,
    extraWhere: isNotNull(lostItems.resolvedAt),
  },
  // Notes sent to a whole departure, on the send's own time (batch 4, J4).
  departure_notes: {
    from: departureNotes,
    id: departureNotes.id,
    clock: departureNotes.sentAt,
  },
  // The manifest's shift catch-up (issues #1202, #1187). Pruned on the event's
  // own `occurred_at`: a desk act is a same-day handoff, so its age is the only
  // thing that decides, and a departure that was moved or never sailed is
  // bounded the same way as one that did.
  trip_desk_events: {
    from: tripDeskEvents,
    id: tripDeskEvents.id,
    clock: tripDeskEvents.occurredAt,
  },
  // A staff form's draft (ADR 20260906-before-you-ask, decision 3), on the
  // moment it was last typed into: the reader already hides one older than a
  // day, so this clears rows nobody can reach.
  form_drafts: {
    from: formDrafts,
    id: formDrafts.id,
    clock: formDrafts.savedAt,
  },
  // The founder digest's demo count (ADR 20261007-founder-metrics), on the
  // instant of the entry.
  demo_entries: {
    from: demoEntries,
    id: demoEntries.id,
    clock: demoEntries.enteredAt,
  },
  // The marks that point into those events, on `last_seen_at` rather than a
  // creation time: a mark a staffer keeps moving forward is live state, and
  // only one nobody has touched in a month has nothing left to point at.
  trip_read_marks: {
    from: tripReadMarks,
    id: tripReadMarks.id,
    clock: tripReadMarks.lastSeenAt,
  },
  // The inbox (ADR 20260907-two-way-inbox), replies first: a reply names the
  // message it answered with ON DELETE SET NULL, so either order is safe, but
  // deleting the answer before the question keeps a half-pruned thread from
  // reading as a message nobody answered. Both measured on the instant the
  // words arrived or went out, never on the row's own insert.
  staff_replies: {
    from: staffReplies,
    id: staffReplies.id,
    clock: staffReplies.sentAt,
  },
  inbound_messages: {
    from: inboundMessages,
    id: inboundMessages.id,
    clock: inboundMessages.receivedAt,
  },
} satisfies Record<RetainedTable, PruneArm>;

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
  const outcomes: PruneOutcome[] = [];
  for (const [table, arm] of Object.entries(PRUNE_ARMS) as [RetainedTable, PruneArm][]) {
    outcomes.push(await pruneBatch(db, table, arm, now));
  }
  return {
    outcomes,
    totalDeleted: outcomes.reduce((sum, outcome) => sum + outcome.deleted, 0),
    failedTables: outcomes.filter((outcome) => outcome.failed).map((outcome) => outcome.table),
  };
}
