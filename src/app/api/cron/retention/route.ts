import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { pruneExpiredRecords } from "@/db/retention";
import { log } from "@/lib/log";
import { flushLogs } from "@/lib/observability";

/**
 * A prune pass is a handful of bounded deletes (`PRUNE_BATCH_LIMIT` rows per
 * table), so it should finish in seconds — but it is still a set of DELETEs
 * against a growing table, and a bound beats an unbounded hold on a function
 * slot. 60s is far above the observed tick and still kills a pass that has
 * wedged, rather than letting it sit open. Raise it only with evidence from
 * `cron_retention.prune_complete`.
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
  schedule: { type: "crontab", value: "30 3 * * 0" },
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
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse(null, { status: 401 });
  }

  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: CRON_MONITOR_SLUG, status: "in_progress" },
    CRON_MONITOR_CONFIG,
  );

  try {
    const db = await getDb();
    const summary = await pruneExpiredRecords(db);

    for (const outcome of summary.outcomes) {
      if (outcome.failed) {
        Sentry.captureMessage("retention prune arm failed", {
          level: "error",
          tags: { retention_table: outcome.table },
        });
      }
    }

    // One line per run naming every table, its window, and what it removed —
    // ids and codes only (LogContext's rule), which is all this pass ever
    // knows about a row anyway.
    log("cron_retention.prune_complete", "info", {
      totalDeleted: summary.totalDeleted,
      tablesFailed: summary.failedTables.length,
      failedTables: summary.failedTables.length > 0 ? summary.failedTables.join(",") : undefined,
      // `capped` is the signal that a backlog is still draining: the next
      // weekly pass will take another batch.
      tablesCapped:
        summary.outcomes
          .filter((outcome) => outcome.capped)
          .map((outcome) => outcome.table)
          .join(",") || undefined,
      ...Object.fromEntries(
        summary.outcomes.map((outcome) => [`${outcome.table}_deleted`, outcome.deleted]),
      ),
    });

    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: CRON_MONITOR_SLUG,
      status: summary.failedTables.length > 0 ? "error" : "ok",
    });

    // A partial pass answers 500 so the scheduler's invocation log agrees with
    // Sentry that this run was not clean. Every arm is idempotent, so a retry
    // re-runs the failed one without re-deleting anything already gone.
    return NextResponse.json(summary, {
      status: summary.failedTables.length > 0 ? 500 : 200,
    });
  } catch (error) {
    // Only reachable before any arm runs — `getDb()` failing to connect or
    // migrate. The check-in still has to be closed out or the monitor would
    // read this as a run that is somehow still in progress.
    Sentry.captureException(error, { tags: { cron_scan: "retention_bootstrap" } });
    log("cron_retention.prune_failed", "error", { scan: "bootstrap" });
    Sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "error" });
    return NextResponse.json({ error: "prune_unavailable" }, { status: 503 });
  } finally {
    // The pass's log line *is* the record that it ran and what it deleted, so
    // this is one of the few places the shipping is awaited rather than left to
    // the post-response deferrer (ADR 20260806-cloudwatch-log-shipping). A prune
    // takes seconds; one PutLogEvents call is not the cost that matters here.
    await flushLogs();
  }
}
