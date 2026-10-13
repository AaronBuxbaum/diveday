import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { sendTrailingDeskPings } from "@/db/desk-pings";
import { requireCronSecret } from "@/lib/cron-auth";
import { DESK_PING_CRON_CRONTAB } from "@/lib/desk-hours";
import { log } from "@/lib/log";
import { flushLogs } from "@/lib/observability";
import { sentry } from "@/lib/observability/sentry";

const CRON_MONITOR_SLUG = "diveday-desk-pings";
const CRON_MONITOR_CONFIG = {
  schedule: { type: "crontab", value: DESK_PING_CRON_CRONTAB },
  checkinMargin: 20,
  maxRuntime: 10,
  timezone: "Etc/UTC",
} as const;

/**
 * **The after-hours desk ping's trailing catch-up, hourly** (#2311).
 *
 * The webhook pings a staffer at most once per half hour; a diver message
 * batched behind that ping, with nothing arriving after it, used to wait until
 * morning. This pass sends one catch-up to each staffer owed one
 * (`sendTrailingDeskPings`). It sends fresh mail only and never drains the
 * notification queue.
 */
export async function GET(request: Request) {
  // The shared constant-time check every cron route uses (src/lib/cron-auth.ts).
  const refused = requireCronSecret(request);
  if (refused) return refused;

  const checkInId = await sentry.captureCheckIn(
    { monitorSlug: CRON_MONITOR_SLUG, status: "in_progress" },
    CRON_MONITOR_CONFIG,
  );
  try {
    const summary = await sendTrailingDeskPings(await getDb());
    log("cron_desk_pings.scan_complete", "info", summary);
    await sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "ok" });
    return NextResponse.json(summary);
  } catch (error) {
    await sentry.captureException(error, { tags: { cron_scan: "desk_pings" } });
    log("cron_desk_pings.scan_failed", "error", { scan: "desk_pings" });
    await sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "error" });
    return NextResponse.json({ error: "scan_unavailable" }, { status: 503 });
  } finally {
    await flushLogs();
  }
}
