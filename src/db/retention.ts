import { and, eq, inArray, isNotNull, isNull, lt, or, SQL, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import {
  dietaryNoteCutoff,
  PRUNE_BATCH_LIMIT,
  RETENTION_DAYS,
  type RetainedTable,
  retentionCutoff,
} from "@/lib/retention";
import type { AppDb } from "./client";
import { boundLockWaits } from "./lock-bounds";
import {
  accountSessions,
  accountSignInChallenges,
  accountTokens,
  activityEvents,
  assistResults,
  bookingCapabilities,
  bookingPaymentEvents,
  bookings,
  claudeCallContent,
  claudeUsage,
  crewNotices,
  demoEntries,
  departureNotes,
  emailBounces,
  formDrafts,
  inboundMessages,
  incidentReports,
  integrationEvents,
  integrationOauthStates,
  lostItems,
  notificationDeliveries,
  notificationDeliveryAttempts,
  notificationSendQueue,
  pushSubscriptions,
  retentionPruneState,
  setupRequests,
  shopBackupDeliveryClaims,
  shopContactEmailConfirmationTokens,
  shopShoreAlertTokens,
  staffReplies,
  stripeWebhookEvents,
  todayReadMarks,
  tripDeskEvents,
  tripReadMarks,
  trips,
  waiverDeliveries,
  websiteSetupDrafts,
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
 * - **Bounded.** At most {@link PRUNE_BATCH_LIMIT} rows per batch. Elapsed time
 *   bounds admission; one slow in-flight batch can outlast the budget. A backlog
 *   converges over successive weekly ticks (`vercel.json`, Sundays 03:08 UTC)
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
  /** Rows actually deleted this run, across every batch it took. */
  deleted: number;
  /**
   * True when the run's last batch from this table hit the cap: the time budget
   * ended before proving the table drained. Logged as `cron_retention.prune_capped`.
   */
  capped: boolean;
  /** True when a batch from this table threw; it is not retried this run. */
  failed: boolean;
  /** No batch ran; eligibility is unknown, rather than proven drained. */
  skipped: boolean;
  /** The window applied, echoed so a report never has to re-derive it. */
  retentionDays: number;
};

export type PruneSummary = {
  outcomes: PruneOutcome[];
  totalDeleted: number;
  failedTables: RetainedTable[];
  skippedTables: RetainedTable[];
};

/**
 * **Clears the lunch note from seats whose boat sailed more than
 * `DIETARY_NOTE_RETENTION_DAYS` ago** (item 56; security review N5). The
 * booking stays; only the diver's words about their food go. Bounded like a
 * prune batch, and measured from the departure's own start.
 */
export async function clearExpiredDietaryNotes(
  db: AppDb,
  now: Date,
  batchLimit: number = PRUNE_BATCH_LIMIT,
): Promise<number> {
  // Eligibility is read at this statement's snapshot, avoiding a separate
  // select/update gap; this does not serialize with later departure moves.
  // The outer null check and RETURNING count only this statement's mutations,
  // including when a concurrent sweep already cleared some selected seats.
  const eligible = db
    .select({ id: bookings.id })
    .from(bookings)
    // diveday:allow-deleted-trips: a deleted departure's food notes expire too.
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(and(isNotNull(bookings.dietaryNote), lt(trips.startsAt, dietaryNoteCutoff(now))))
    .limit(batchLimit);
  const cleared = await db
    .update(bookings)
    .set({ dietaryNote: null })
    .where(and(isNotNull(bookings.dietaryNote), inArray(bookings.id, eligible)))
    .returning({ id: bookings.id });
  return cleared.length;
}

export type DietaryRetentionSummary = { cleared: number; capped: boolean; failed: boolean };

/** The daily sweep's own admission budget, independent of weekly table backlogs. */
export const DIETARY_RETENTION_TIME_BUDGET_MS = 45_000;

/**
 * Drain eligible food notes under one cutoff and a monotonic admission budget.
 * The budget bounds batch admission, not statement duration: one admitted batch
 * may still be in flight after the deadline. A full last batch is conservatively
 * capped; no query is started after the deadline just to prove the backlog empty.
 * Errors return a failed outcome without sending database error text to telemetry.
 */
export async function drainExpiredDietaryNotes(
  db: AppDb,
  opts: { now?: Date; budgetMs?: number; batchLimit?: number } = {},
): Promise<DietaryRetentionSummary> {
  const now = opts.now ?? nowDate();
  const budgetMs = opts.budgetMs ?? DIETARY_RETENTION_TIME_BUDGET_MS;
  const batchLimit = opts.batchLimit ?? PRUNE_BATCH_LIMIT;
  const started = performance.now();
  let cleared = 0;
  while (performance.now() - started < budgetMs) {
    try {
      const batch = await clearExpiredDietaryNotes(db, now, batchLimit);
      cleared += batch;
      if (batch < batchLimit) return { cleared, capped: false, failed: false };
    } catch {
      // The route reports this code/count outcome to Sentry and CloudWatch.
      // A driver error may quote the note or its identity-bearing parameters.
      return { cleared, capped: false, failed: true };
    }
  }
  return { cleared, capped: true, failed: false };
}

export type ClaudeCallContentRetentionSummary = {
  deleted: number;
  capped: boolean;
  failed: boolean;
};

/** The daily Claude sweep's admission budget, beside the dietary sweep's in one cron. */
export const CLAUDE_CALL_CONTENT_RETENTION_TIME_BUDGET_MS = 5_000;

/**
 * **Deletes Claude call content past its 30 days, daily** (ADR
 * 20261023-claude-call-content). The weekly prune reaches the table too, but a
 * row it found on day 29 would live to day 36; this drain, run by the daily
 * privacy cron, keeps "30 days" to the day. Same batches and the same
 * monotonic admission budget as the dietary sweep; a statement error is a
 * failed outcome, never its text.
 */
export async function drainExpiredClaudeCallContent(
  db: AppDb,
  opts: { now?: Date; budgetMs?: number; batchLimit?: number } = {},
): Promise<ClaudeCallContentRetentionSummary> {
  const now = opts.now ?? nowDate();
  const budgetMs = opts.budgetMs ?? CLAUDE_CALL_CONTENT_RETENTION_TIME_BUDGET_MS;
  const batchLimit = opts.batchLimit ?? PRUNE_BATCH_LIMIT;
  const started = performance.now();
  let deleted = 0;
  while (performance.now() - started < budgetMs) {
    const batch = await pruneBatch(
      db,
      "claude_call_content",
      PRUNE_ARMS.claude_call_content,
      now,
      batchLimit,
    );
    deleted += batch.deleted;
    if (batch.failed) return { deleted, capped: false, failed: true };
    if (!batch.capped) return { deleted, capped: false, failed: false };
  }
  return { deleted, capped: true, failed: false };
}

/**
 * `clock < cutoff`, for a column or an expression. The two branches are the
 * same call: drizzle's `lt` overloads take a column or an `SQL`, never the
 * union, so the narrowing is what lets one arm table hold both kinds of clock.
 */
function olderThan(clock: PgColumn | SQL, cutoff: Date): SQL {
  return clock instanceof SQL ? lt(clock, cutoff) : lt(clock, cutoff);
}

/** Match recorded prune identities, including SQL expressions for composite keys. */
export function retentionIdentityMatches(id: PgColumn | SQL, ids: string[]): SQL {
  if (id instanceof SQL) return inArray(id, ids);
  return inArray(id, ids);
}

/**
 * Selects at most `batchLimit` eligible candidates, then rechecks their age and
 * extra eligibility when deleting. A committed legal hold must survive a wait
 * on its report's row lock. RETURNING counts only this statement's deletions;
 * the candidate count still determines whether more eligible work may remain.
 */
async function pruneBatch(
  db: AppDb,
  table: RetainedTable,
  arm: PruneArm,
  now: Date,
  batchLimit: number = PRUNE_BATCH_LIMIT,
): Promise<PruneOutcome> {
  const retentionDays = RETENTION_DAYS[table];
  const eligible = and(olderThan(arm.clock, retentionCutoff(table, now)), arm.extraWhere);
  try {
    const rows = (await db
      .select({ id: arm.id })
      .from(arm.from)
      .where(eligible)
      .limit(batchLimit)) as { id: string }[];
    if (rows.length === 0) {
      return { table, deleted: 0, capped: false, failed: false, skipped: false, retentionDays };
    }
    const deleted = await db
      .delete(arm.from)
      .where(
        and(
          retentionIdentityMatches(
            arm.id,
            rows.map((row) => row.id),
          ),
          eligible,
        ),
      )
      .returning({ id: arm.id });
    return {
      table,
      deleted: deleted.length,
      capped: rows.length >= batchLimit,
      failed: false,
      skipped: false,
      retentionDays,
    };
  } catch {
    // Codes, not sentences, and no row contents: this module is one table over
    // from medical and payment data, so the log line carries the table code and
    // nothing else. The throw is re-reported by the caller (Sentry, in the cron
    // route) with the same tag.
    log("retention.prune_failed", "error", { table });
    return { table, deleted: 0, capped: false, failed: true, skipped: false, retentionDays };
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
  /** A single key column or a unique SQL expression for composite keys. */
  id: PgColumn | SQL;
  clock: PgColumn | SQL;
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
  account_sign_in_challenges: {
    from: accountSignInChallenges,
    id: accountSignInChallenges.id,
    clock: accountSignInChallenges.expiresAt,
  },
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
  // The shore contact's links (H-118): from `created_at`, since a stop link
  // has no `expires_at` of its own.
  shop_shore_alert_tokens: {
    from: shopShoreAlertTokens,
    id: shopShoreAlertTokens.id,
    clock: shopShoreAlertTokens.createdAt,
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
  // Claims remain the duplicate-upload fence until the successful delivery
  // row is visible and for a full season/year afterward. Incomplete attempts
  // age from lease expiry; completed attempts age from completion. The
  // composite expression identifies one shop/week without widening deletes
  // to other shops that share the same period key.
  shop_backup_delivery_claims: {
    from: shopBackupDeliveryClaims,
    id: sql<string>`${shopBackupDeliveryClaims.shopId}::text || ':' || ${shopBackupDeliveryClaims.periodKey}`,
    clock: sql`coalesce(${shopBackupDeliveryClaims.completedAt}, ${shopBackupDeliveryClaims.leaseUntil})`,
    extraWhere: or(
      isNotNull(shopBackupDeliveryClaims.completedAt),
      isNotNull(shopBackupDeliveryClaims.leaseUntil),
    ),
  },
  // Claude's per-call cost ledger (ADR 20261018-claude-assists), on its own age.
  claude_usage: {
    from: claudeUsage,
    id: claudeUsage.id,
    clock: claudeUsage.createdAt,
  },
  // What a Claude call said, on its own age: 30 days of debugging text.
  claude_call_content: {
    from: claudeCallContent,
    id: claudeCallContent.id,
    clock: claudeCallContent.createdAt,
  },
  // What an assist answered, on the age of its last answer: a row nobody asked
  // again for a season and a year is about reviews and weeks long gone.
  assist_results: {
    from: assistResults,
    id: assistResults.id,
    clock: assistResults.updatedAt,
  },
  // The website setup's proposals, one row per shop, on the age of its reading.
  website_setup_drafts: {
    from: websiteSetupDrafts,
    id: websiteSetupDrafts.shopId,
    clock: websiteSetupDrafts.readAt,
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
  // A bounce or complaint on the day SES reported it.
  email_bounces: {
    from: emailBounces,
    id: emailBounces.id,
    clock: emailBounces.occurredAt,
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
  today_read_marks: {
    from: todayReadMarks,
    id: todayReadMarks.id,
    clock: todayReadMarks.lastSeenAt,
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
  // Incident reports (ADR 20261012-incident-reports): seven years from when the
  // incident happened, or from when a draft that never said so was started.
  // Its people and addenda cascade with it. A report an owner has put a legal
  // hold on is skipped until the hold is released.
  incident_reports: {
    from: incidentReports,
    id: incidentReports.id,
    clock: sql`coalesce(${incidentReports.occurredAt}, ${incidentReports.createdAt})`,
    extraWhere: isNull(incidentReports.legalHoldAt),
  },
} satisfies Record<RetainedTable, PruneArm>;

/** Batch admissions stop at 45 seconds, within the route's unchanged 60-second ceiling. */
export const PRUNE_TIME_BUDGET_MS = 45_000;

const TABLES = Object.keys(PRUNE_ARMS) as RetainedTable[];
const FIRST_TABLE: RetainedTable = "stripe_webhook_events";

/** One initialization per run, separate from the short reservation transaction. */
export async function initializeRetentionPruneState(db: AppDb): Promise<void> {
  await db
    .insert(retentionPruneState)
    .values({ id: "weekly", nextTable: FIRST_TABLE })
    .onConflictDoNothing();
}

/**
 * Reserve the first pending table at/after the durable cursor and advance to its
 * canonical successor. Commit before any destructive work: a killed or failed
 * batch gives the following table priority on the next invocation. The state
 * lock is bounded and held only for these two machinery queries, never a prune.
 * Unknown codes recover at the first table, permitting future registry changes.
 */
export async function reserveRetentionPruneTable(
  db: AppDb,
  pending: ReadonlySet<RetainedTable>,
): Promise<RetainedTable> {
  return db.transaction(async (tx) => {
    await boundLockWaits(tx);
    const [state] = await tx
      .select()
      .from(retentionPruneState)
      .where(eq(retentionPruneState.id, "weekly"))
      .for("update");
    if (!state) throw new Error("retention_prune_state_missing");
    const cursor = (TABLES as readonly string[]).indexOf(state.nextTable);
    const start = cursor < 0 ? 0 : cursor;
    for (let offset = 0; offset < TABLES.length; offset += 1) {
      const index = (start + offset) % TABLES.length;
      const table = TABLES[index];
      if (table && pending.has(table)) {
        await tx
          .update(retentionPruneState)
          .set({ nextTable: TABLES[(index + 1) % TABLES.length] ?? FIRST_TABLE })
          .where(eq(retentionPruneState.id, "weekly"));
        return table;
      }
    }
    throw new Error("retention_prune_pending_empty");
  });
}

/**
 * One batch per pending table per round; later rounds revisit only full,
 * nonfailed tables. Durable reservations determine priority even across retries
 * at the same application instant. Each reservation commits before a prune.
 *
 * Monotonic elapsed time bounds admission, not execution: await an admitted
 * batch even if it finishes after the deadline, and never start the next one.
 * Check again after reserving, because lock/pool waits spend the budget too.
 * Call with the database, never an enclosing transaction: progress must survive
 * platform termination independently of the destructive batch.
 */
export async function pruneExpiredRecords(
  db: AppDb,
  opts: { now?: Date; budgetMs?: number; batchLimit?: number } = {},
): Promise<PruneSummary> {
  const now = opts.now ?? nowDate();
  const budgetMs = opts.budgetMs ?? PRUNE_TIME_BUDGET_MS;
  const batchLimit = opts.batchLimit ?? PRUNE_BATCH_LIMIT;
  const started = performance.now();
  const withinBudget = () => performance.now() - started < budgetMs;
  const outcomes: PruneOutcome[] = TABLES.map((table) => ({
    table,
    deleted: 0,
    capped: false,
    failed: false,
    skipped: true,
    retentionDays: RETENTION_DAYS[table],
  }));
  const byTable = new Map(outcomes.map((outcome) => [outcome.table, outcome]));
  let pending = new Set(TABLES);
  if (withinBudget()) {
    await initializeRetentionPruneState(db);
    while (pending.size > 0 && withinBudget()) {
      const table = await reserveRetentionPruneTable(db, pending);
      if (!withinBudget()) break;
      pending.delete(table);
      const before = byTable.get(table);
      if (!before) throw new Error("retention_prune_outcome_missing");
      const batch = await pruneBatch(db, table, PRUNE_ARMS[table], now, batchLimit);
      Object.assign(before, batch, { deleted: before.deleted + batch.deleted });
      if (pending.size === 0) {
        pending = new Set(
          outcomes
            .filter((outcome) => outcome.capped && !outcome.failed)
            .map((outcome) => outcome.table),
        );
      }
    }
  }
  return {
    outcomes,
    totalDeleted: outcomes.reduce((sum, outcome) => sum + outcome.deleted, 0),
    failedTables: outcomes.filter((outcome) => outcome.failed).map((outcome) => outcome.table),
    skippedTables: outcomes.filter((outcome) => outcome.skipped).map((outcome) => outcome.table),
  };
}
