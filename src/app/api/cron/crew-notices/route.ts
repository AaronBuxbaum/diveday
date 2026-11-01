import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { sendDueCrewNotices } from "@/db/crew-notices";
import { sendMissingDiverAlerts } from "@/db/missing-diver-alerts";
import { sendStaleRollCallAlerts } from "@/db/roll-call-alerts";
import { CREW_NOTICE_CRON_CRONTAB } from "@/lib/crew-notices";
import { requireCronSecret } from "@/lib/cron-auth";
import { log } from "@/lib/log";
import { flushLogs } from "@/lib/observability";
import { sentry } from "@/lib/observability/sentry";

const CRON_MONITOR_SLUG = "diveday-crew-notices";
const CRON_MONITOR_CONFIG = {
  schedule: { type: "crontab", value: CREW_NOTICE_CRON_CRONTAB },
  checkinMargin: 20,
  maxRuntime: 10,
  timezone: "Etc/UTC",
} as const;

/**
 * **Crew hear about their boats, hourly** (ADR
 * 20261009-crew-hear-about-their-boats).
 *
 * Every person whose crew has been still for the settle window gets one
 * message netting what changed (`sendDueCrewNotices`). Hourly at `:06` (`vercel.json`), inside
 * the five minutes the other hourly passes share, so it adds no database
 * wake-up of its own (`src/lib/cron-schedule.test.ts`). Hourly rather than
 * gated to fewer hours: news settles within minutes at any hour, and the one
 * read that finds none is the whole cost of an idle pass. It sends fresh mail only; the kind is never
 * queued for a retry.
 *
 * The same pass raises the **stale roll-call alert** (`sendStaleRollCallAlerts`):
 * an after-dive count still open after the boat was due back reaches the
 * shop's owners once per trip, and the shore contact, once confirmed, under a
 * claim of its own (`src/db/roll-call-alerts.ts` has the timing). It runs in its own try so a failure there never
 * costs the crew their notices, and theirs never costs the alert.
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
    const db = await getDb();
    const rollCall = await staleRollCallPass(db);
    const missingDiver = await missingDiverPass(db);
    const summary = await sendDueCrewNotices(db);
    log("cron_crew_notices.scan_complete", "info", summary);
    await sentry.captureCheckIn({
      checkInId,
      monitorSlug: CRON_MONITOR_SLUG,
      // A filed report of a missing diver whose owners are still untold is
      // this monitor's error, so someone is paged to call them.
      status: rollCall && missingDiver && missingDiver.overdue === 0 ? "ok" : "error",
    });
    return NextResponse.json({ ...summary, rollCall, missingDiver });
  } catch (error) {
    await sentry.captureException(error, { tags: { cron_scan: "crew_notices" } });
    log("cron_crew_notices.scan_failed", "error", { scan: "crew_notices" });
    await sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "error" });
    return NextResponse.json({ error: "scan_unavailable" }, { status: 503 });
  } finally {
    await flushLogs();
  }
}

/** The stale roll-call pass, held apart: a throw is reported and answered as `null`. */
async function staleRollCallPass(db: Awaited<ReturnType<typeof getDb>>) {
  try {
    const summary = await sendStaleRollCallAlerts(db);
    log("cron_roll_call_alerts.scan_complete", "info", summary);
    return summary;
  } catch (error) {
    await sentry.captureException(error, { tags: { cron_scan: "roll_call_alerts" } });
    log("cron_roll_call_alerts.scan_failed", "error", { scan: "roll_call_alerts" });
    return null;
  }
}

/**
 * The missing-diver alert's retry (H-20261016-missing-diver-report-alerts), held apart like the pass above: filing a
 * report sends at once, and this finds a filed report whose owners were not
 * all told. A throw is reported and answered as `null`; a report still untold
 * half an hour after filing (`overdue`) turns the monitor's check-in to error.
 */
async function missingDiverPass(db: Awaited<ReturnType<typeof getDb>>) {
  try {
    const summary = await sendMissingDiverAlerts(db);
    log("cron_missing_diver_alerts.scan_complete", "info", summary);
    return summary;
  } catch (error) {
    await sentry.captureException(error, { tags: { cron_scan: "missing_diver_alerts" } });
    log("cron_missing_diver_alerts.scan_failed", "error", { scan: "missing_diver_alerts" });
    return null;
  }
}
