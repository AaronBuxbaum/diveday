import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { sendDueWeeklyDigests } from "@/db/weekly-digest";
import { nowDate } from "@/lib/clock";
import { requireCronSecret } from "@/lib/cron-auth";
import { log } from "@/lib/log";
import { flushLogs } from "@/lib/observability";
import { WEEKLY_DIGEST_CRON_CRONTAB, weeklyDigestMayBeDueSomewhere } from "@/lib/weekly-digest";

/** A Monday morning can fall due for many shops in one pass. */
export const maxDuration = 300;

/** Its own monitor: a weekly promise on an hourly cadence, Sunday to Tuesday UTC. */
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
 *
 * Scheduled Sunday to Tuesday UTC only, and an hour of those three days that
 * is outside every zone's Monday sending hours checks in and stops before the
 * database (`weeklyDigestMayBeDueSomewhere`): no shop can be due, so there is
 * nothing to read.
 */
export async function GET(request: Request) {
  // The shared constant-time check every cron route uses (src/lib/cron-auth.ts).
  const refused = requireCronSecret(request);
  if (refused) return refused;

  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: CRON_MONITOR_SLUG, status: "in_progress" },
    CRON_MONITOR_CONFIG,
  );
  try {
    if (!weeklyDigestMayBeDueSomewhere(nowDate())) {
      Sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "ok" });
      return NextResponse.json({ skipped: "no_shop_in_its_monday" });
    }
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
