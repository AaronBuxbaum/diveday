import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { sendDueWeeklyDigests } from "@/db/weekly-digest";
import { log } from "@/lib/log";
import { flushLogs } from "@/lib/observability";
import { WEEKLY_DIGEST_CRON_CRONTAB } from "@/lib/weekly-digest";

/** A Monday morning can fall due for many shops in one pass. */
export const maxDuration = 300;

/** Its own monitor: a weekly promise on an hourly cadence, unlike any other pass. */
const CRON_MONITOR_SLUG =
  process.env.SENTRY_WEEKLY_DIGEST_CRON_MONITOR_SLUG || "diveday-weekly-digest";
const CRON_MONITOR_CONFIG = {
  schedule: { type: "crontab", value: WEEKLY_DIGEST_CRON_CRONTAB },
  checkinMargin: 20,
  maxRuntime: 10,
  timezone: "Etc/UTC",
} as const;

/**
 * **The Monday email pass, hourly** (market audit item 51).
 *
 * Hourly for the trip-reminder pass's reason: one fixed UTC hour is Monday
 * breakfast in one longitude and Sunday night in another. Each pass sends for
 * the shops whose own calendar says it is Monday inside the sending hours, and
 * the per-person, per-week claim in `weekly_digest_sends` makes every later
 * pass that day, and any re-run, a no-op.
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
    const summary = await sendDueWeeklyDigests(await getDb());
    log("cron_weekly_digest.scan_complete", "info", summary);
    Sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "ok" });
    return NextResponse.json(summary);
  } catch (error) {
    Sentry.captureException(error, { tags: { cron_scan: "weekly_digest" } });
    log("cron_weekly_digest.scan_failed", "error", { scan: "weekly_digest" });
    Sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "error" });
    return NextResponse.json({ error: "scan_unavailable" }, { status: 503 });
  } finally {
    await flushLogs();
  }
}
