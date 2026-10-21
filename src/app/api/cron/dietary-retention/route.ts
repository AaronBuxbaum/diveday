import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { drainExpiredDietaryNotes } from "@/db/retention";
import { requireCronSecret } from "@/lib/cron-auth";
import { log } from "@/lib/log";
import { flushLogs } from "@/lib/observability";
import { sentry } from "@/lib/observability/sentry";
import { DIETARY_RETENTION_CRONTAB } from "@/lib/retention";

/** 45 seconds of batch admission leaves room for an in-flight batch and reporting. */
export const maxDuration = 60;
const CRON_MONITOR_SLUG = "diveday-dietary-retention";
const CRON_MONITOR_CONFIG = {
  schedule: { type: "crontab", value: DIETARY_RETENTION_CRONTAB },
  checkinMargin: 240,
  maxRuntime: 5,
  timezone: "Etc/UTC",
} as const;

/** Daily privacy sweep, independent of the weekly table prune's budget and backlog. */
export async function GET(request: Request) {
  const refusal = requireCronSecret(request);
  if (refusal) return refusal;

  const checkInId = await sentry.captureCheckIn(
    { monitorSlug: CRON_MONITOR_SLUG, status: "in_progress" },
    CRON_MONITOR_CONFIG,
  );
  try {
    const db = await getDb();
    const summary = await drainExpiredDietaryNotes(db);
    if (summary.failed) {
      log("cron_dietary_retention.clear_failed", "error", { cleared: summary.cleared });
      await sentry.captureMessage("dietary retention failed", { level: "error" });
    }
    if (summary.capped) {
      log("cron_dietary_retention.clear_capped", "warn", { cleared: summary.cleared });
    }
    log("cron_dietary_retention.clear_complete", "info", summary);
    await sentry.captureCheckIn({
      checkInId,
      monitorSlug: CRON_MONITOR_SLUG,
      status: summary.failed || summary.capped ? "error" : "ok",
    });
    // As for weekly table retention, a cap is an explicit 200 outcome; a
    // statement failure is 500. Both incomplete outcomes flag the monitor.
    return NextResponse.json(summary, { status: summary.failed ? 500 : 200 });
  } catch {
    // Even a connection error can quote credentials or query parameters.
    log("cron_dietary_retention.clear_failed", "error", { scan: "bootstrap" });
    await sentry.captureMessage("dietary retention unavailable", { level: "error" });
    await sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "error" });
    return NextResponse.json({ error: "dietary_retention_unavailable" }, { status: 503 });
  } finally {
    await flushLogs();
  }
}
