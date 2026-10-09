import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { sendDueCrewNotices } from "@/db/crew-notices";
import { CREW_NOTICE_CRON_CRONTAB } from "@/lib/crew-notices";
import { log } from "@/lib/log";
import { flushLogs } from "@/lib/observability";

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
 * message netting what changed (`sendDueCrewNotices`). Hourly at `:00`, beside
 * the other hourly passes, so it adds no database wake-up of its own
 * (`src/lib/cron-schedule.test.ts`). It sends fresh mail only; the kind is never
 * queued for a retry.
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
    const summary = await sendDueCrewNotices(await getDb());
    log("cron_crew_notices.scan_complete", "info", summary);
    Sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "ok" });
    return NextResponse.json(summary);
  } catch (error) {
    Sentry.captureException(error, { tags: { cron_scan: "crew_notices" } });
    log("cron_crew_notices.scan_failed", "error", { scan: "crew_notices" });
    Sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "error" });
    return NextResponse.json({ error: "scan_unavailable" }, { status: 503 });
  } finally {
    await flushLogs();
  }
}
