/** retention public contract. Internals are imported only within this module. */

export type { RetainedTable } from "./rules";
export {
  ACCOUNT_TOKEN_RETENTION_DAYS,
  activityRetentionDays,
  DESK_LINE_RETENTION_DAYS,
  DIETARY_NOTE_RETENTION_DAYS,
  DIETARY_RETENTION_CRONTAB,
  deskLineRetentionCutoff,
  dietaryNoteCutoff,
  PRUNE_BATCH_LIMIT,
  RETENTION_DAYS,
  retentionCutoff,
  retentionWindowsOutlastStripeRetries,
  STRIPE_WEBHOOK_RETRY_DAYS,
  UNBOUNDED_BY_DECISION,
} from "./rules";
export type {
  ClaudeCallContentRetentionSummary,
  DietaryRetentionSummary,
  PruneOutcome,
  PruneSummary,
} from "./store";
export {
  CLAUDE_CALL_CONTENT_RETENTION_TIME_BUDGET_MS,
  clearExpiredDietaryNotes,
  DIETARY_RETENTION_TIME_BUDGET_MS,
  drainExpiredClaudeCallContent,
  drainExpiredDietaryNotes,
  initializeRetentionPruneState,
  PRUNE_ARMS,
  PRUNE_TIME_BUDGET_MS,
  pruneExpiredRecords,
  reserveRetentionPruneTable,
  retentionIdentityMatches,
} from "./store";
