import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { sendDueRecaps } from "@/db/recap";
import { log } from "@/lib/log";
import { flushLogs } from "@/lib/observability";
import { RECAP_CRON_CRONTAB } from "@/lib/recap-schedule";

/** Recaps may send a whole returned boat's follow-ups; keep the provider-bound pass bounded. */
export const maxDuration = 300;

/** A separate monitor from the daily retry drain: their delivery promises differ. */
const CRON_MONITOR_SLUG = process.env.SENTRY_RECAP_CRON_MONITOR_SLUG || "diveday-recaps";
const CRON_MONITOR_CONFIG = {
  schedule: { type: "crontab", value: RECAP_CRON_CRONTAB },
  checkinMargin: 20,
  maxRuntime: 10,
  timezone: "Etc/UTC",
} as const;

/**
 * The post-dive recap pass is hourly so a returned boat's follow-up arrives
 * within an hour of its four-hour floor. The floor remains in `sendDueRecaps`,
 * rather than being inferred from this cadence, and the per-booking delivery
 * row makes reruns safe.
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
    const summary = await sendDueRecaps(await getDb());
    log("cron_recaps.scan_complete", "info", summary);
    Sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "ok" });
    return NextResponse.json(summary);
  } catch (error) {
    Sentry.captureException(error, { tags: { cron_scan: "recaps" } });
    log("cron_recaps.scan_failed", "error", { scan: "recaps" });
    Sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "error" });
    return NextResponse.json({ error: "scan_unavailable" }, { status: 503 });
  } finally {
    await flushLogs();
  }
}
