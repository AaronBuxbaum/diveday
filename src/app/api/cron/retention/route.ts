import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { pruneExpiredRecords } from "@/db/retention";
import { requireCronSecret } from "@/lib/cron-auth";
import { log } from "@/lib/log";
import { flushLogs } from "@/lib/observability";
import { sentry } from "@/lib/observability/sentry";

/**
 * A prune run takes batches of `PRUNE_BATCH_LIMIT` rows per table until each
 * table is inside its window or 45 seconds have gone (`PRUNE_TIME_BUDGET_MS`),
 * so an ordinary week finishes in seconds and a backlog spends at most the
 * budget plus one batch. 60s leaves room for that last batch and the log line,
 * and still kills a run that has wedged. Raise both together, and only with
 * evidence from `cron_retention.prune_complete`.
 */
export const maxDuration = 60;

/**
 * Sentry Cron Monitor identity for the weekly prune. Separate from the daily
 * tick's monitor: a missed prune and a missed reminders run are different
 * incidents with different urgency, and collapsing them would hide one behind
 * the other. `SENTRY_RETENTION_CRON_MONITOR_SLUG` lets an operator point at a
 * per-environment monitor without a deploy.
 */
const CRON_MONITOR_SLUG =
  process.env.SENTRY_RETENTION_CRON_MONITOR_SLUG || "diveday-retention-prune";

/**
 * Must stay in lockstep with the `crons` entry in vercel.json — Sentry uses it
 * to decide when a check-in is *missing*, which is the whole point of the
 * dead-man's switch. `checkinMargin` is generous because a prune being a few
 * hours late is not an incident; `maxRuntime` sits above `maxDuration` so a
 * run the platform killed reads as timed-out rather than still running.
 */
const CRON_MONITOR_CONFIG = {
  schedule: { type: "crontab", value: "8 3 * * 0" },
  checkinMargin: 240,
  maxRuntime: 5,
  timezone: "Etc/UTC",
} as const;

/**
 * Prune the append-only tables past their retention windows (DATA-M4/PAY-L2,
 * ADR 20260803-append-only-retention). Weekly rather than daily: retention
 * windows here are measured in hundreds of days, so a daily pass would do
 * nothing 364 times a year while still costing a function invocation and a
 * table scan.
 *
 * **The windows are HD-11's decision to make, not this route's.** It applies
 * whatever `src/lib/retention.ts` states; changing a number is a one-file edit
 * there and needs no change here.
 *
 * Fails closed exactly like `/api/cron/reminders`: `CRON_SECRET` must be
 * configured and presented as a bearer token, or the endpoint answers 503
 * (unconfigured) / 401 (wrong or missing token) and deletes nothing. The auth
 * gate runs *before* the Sentry check-in so an unauthorized probe can never
 * tell the monitor the prune happened.
 *
 * Reports what it deleted three ways, because a prune that silently stops is
 * indistinguishable from a prune with nothing to do: the response body carries
 * the per-table outcomes, `cron_retention.prune_complete` carries the same
 * counts to the log drain, and the Sentry check-in catches the case no
 * in-handler logging can — the run never happening at all.
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
