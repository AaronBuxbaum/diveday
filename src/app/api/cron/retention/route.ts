import { getDb } from "@/db/client";
import { cronRoute } from "@/features/platform/cron-route";
import { sentry } from "@/features/platform/sentry-server";
import { pruneExpiredRecords } from "@/features/records/retention";
import { log } from "@/lib/log";

/** The 45s batch-admission budget is intended to leave room under the 60s
 * platform limit for the last batch and completion log; an in-flight batch can
 * still exceed it. Raise only with recent `cron_retention.scan_complete` evidence. */
export const maxDuration = 60;

/**
 * Weekly pruning applies the HD-11 windows in `src/features/records/retention/rules.ts` (DATA-M4/PAY-L2;
 * ADR 20260803-append-only-retention). Authorization fails closed: missing
 * configuration returns 503, and a missing or wrong bearer token returns 401;
 * the gate precedes Sentry check-in and all deletion. Per-table outcomes go in
 * the response and completion log; the separate Sentry monitor detects a run
 * that never starts, distinguishing no work from no check-in.
 */
export const GET = cronRoute({
  id: "retention",
  monitorSlug: "diveday-retention-prune",
  crontab: "8 3 * * 0",
  checkinMargin: 240,
  maxRuntime: 5,
  run: async () => {
    const db = await getDb();
    const summary = await pruneExpiredRecords(db);

    for (const outcome of summary.outcomes) {
      if (outcome.failed) {
        log("cron_retention.prune_failed", "error", { table: outcome.table });
        await sentry.captureMessage("retention prune arm failed", {
          level: "error",
          tags: { retention_table: outcome.table },
        });
      }
    }

    // Unknown eligibility and an unresolved full batch both need attention.
    // The existing CronPassFailures alarm counts this event.
    const stillCapped = summary.outcomes.filter((outcome) => outcome.capped);
    if (stillCapped.length > 0 || summary.skippedTables.length > 0) {
      log("cron_retention.prune_capped", "warn", {
        tablesCapped: stillCapped.map((outcome) => outcome.table).join(","),
        tablesSkipped: summary.skippedTables.join(","),
      });
    }
    return summary;
  },
  // Failed, capped and skipped tables all flag the monitor. Every arm is
  // idempotent, so a retry re-runs the failed one without re-deleting anything.
  healthy: (summary) =>
    summary.failedTables.length === 0 &&
    summary.skippedTables.length === 0 &&
    !summary.outcomes.some((outcome) => outcome.capped),
});
