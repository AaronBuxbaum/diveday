import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { pruneExpiredRecords } from "@/db/retention";
import { requireCronSecret } from "@/lib/cron-auth";
import { log } from "@/lib/log";
import { flushLogs } from "@/lib/observability";
import { sentry } from "@/lib/observability/sentry";

/** The 45s batch-admission budget is intended to leave room under the 60s
 * platform limit for the last batch and completion log; an in-flight batch can
 * still exceed it. Raise only with recent `cron_retention.prune_complete` evidence. */
export const maxDuration = 60;

/** Dedicated weekly monitor, separate from the daily tick; the
 * `SENTRY_RETENTION_CRON_MONITOR_SLUG` override selects its identity per environment. */
const CRON_MONITOR_SLUG =
  process.env.SENTRY_RETENTION_CRON_MONITOR_SLUG || "diveday-retention-prune";

/** Match `vercel.json` in UTC so Sentry detects a missing check-in; keep
 * `maxRuntime` above the platform's `maxDuration` to report killed runs as timed out. */
const CRON_MONITOR_CONFIG = {
  schedule: { type: "crontab", value: "8 3 * * 0" },
  checkinMargin: 240,
  maxRuntime: 5,
  timezone: "Etc/UTC",
} as const;

/**
 * Weekly pruning applies the HD-11 windows in `src/lib/retention.ts` (DATA-M4/PAY-L2;
 * ADR 20260803-append-only-retention). Authorization fails closed: missing
 * configuration returns 503, and a missing or wrong bearer token returns 401;
 * the gate precedes Sentry check-in and all deletion. Per-table outcomes go in
 * the response and completion log; the separate Sentry monitor detects a run
 * that never starts, distinguishing no work from no check-in.
 */
export async function GET(request: Request) {
  const refusal = requireCronSecret(request);
  if (refusal) return refusal;

  const checkInId = await sentry.captureCheckIn(
    { monitorSlug: CRON_MONITOR_SLUG, status: "in_progress" },
    CRON_MONITOR_CONFIG,
  );

  try {
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
    const tablesSkipped = summary.skippedTables.join(",");
    if (stillCapped.length > 0 || summary.skippedTables.length > 0) {
      log("cron_retention.prune_capped", "warn", {
        tablesCapped: stillCapped.map((outcome) => outcome.table).join(","),
        tablesSkipped,
      });
    }

    // One line per run naming every table, its window, and what it removed —
    // ids and codes only (LogContext's rule), which is all this pass ever
    // knows about a row anyway.
    log("cron_retention.prune_complete", "info", {
      totalDeleted: summary.totalDeleted,
      tablesFailed: summary.failedTables.length,
      tablesSkipped: tablesSkipped || undefined,
      failedTables: summary.failedTables.length > 0 ? summary.failedTables.join(",") : undefined,
      tablesCapped: stillCapped.map((outcome) => outcome.table).join(",") || undefined,
      ...Object.fromEntries(
        summary.outcomes.map((outcome) => [`${outcome.table}_deleted`, outcome.deleted]),
      ),
    });

    await sentry.captureCheckIn({
      checkInId,
      monitorSlug: CRON_MONITOR_SLUG,
      status:
        summary.failedTables.length > 0 ||
        stillCapped.length > 0 ||
        summary.skippedTables.length > 0
          ? "error"
          : "ok",
    });

    // A partial pass answers 500 so the scheduler's invocation log agrees with
    // Sentry that this run was not clean. Every arm is idempotent, so a retry
    // re-runs the failed one without re-deleting anything already gone.
    return NextResponse.json(summary, {
      status: summary.failedTables.length > 0 ? 500 : 200,
    });
  } catch (error) {
    // Connection, migration or checkpoint failure admits no further batch.
    // Close the monitor even when durable scheduling state is unavailable.
    await sentry.captureException(error, { tags: { cron_scan: "retention_bootstrap" } });
    log("cron_retention.prune_failed", "error", { scan: "bootstrap" });
    await sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "error" });
    return NextResponse.json({ error: "prune_unavailable" }, { status: 503 });
  } finally {
    // The pass's log line *is* the record that it ran and what it deleted, so
    // this is one of the few places the shipping is awaited rather than left to
    // the post-response deferrer (ADR 20260806-cloudwatch-log-shipping). A prune
    // takes seconds; one PutLogEvents call is not the cost that matters here.
    await flushLogs();
  }
}
