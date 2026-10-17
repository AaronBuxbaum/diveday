import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { BOOKKEEPER_CRON_CRONTAB } from "@/lib/bookkeeper";
import { nowDate } from "@/lib/clock";
import { requireCronSecret } from "@/lib/cron-auth";
import { log } from "@/lib/log";
import { flushLogs } from "@/lib/observability";
import { sentry } from "@/lib/observability/sentry";
import { sendDueMonthEndEmails } from "./month-end-pass";

/** Many shops can fall due on one 2nd; the files are three reads each. */
export const maxDuration = 300;

const CRON_MONITOR_SLUG = "diveday-bookkeeper";
const CRON_MONITOR_CONFIG = {
  schedule: { type: "crontab", value: BOOKKEEPER_CRON_CRONTAB },
  checkinMargin: 20,
  maxRuntime: 10,
  timezone: "Etc/UTC",
} as const;

/**
 * **The bookkeeper's month-end email, daily on the 2nd and 3rd** (fifth loop,
 * item 35; ADR 20261016-bookkeeper-month-end-email). Each shop with an address
 * gets last month's report, orders and crew sheet once
 * (`sendDueMonthEndEmails`); the 3rd retries a send the 2nd could not make.
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
    const summary = await sendDueMonthEndEmails(await getDb(), { now: nowDate() });
    log("cron_bookkeeper.scan_complete", "info", summary);
    await sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "ok" });
    return NextResponse.json(summary);
  } catch (error) {
    await sentry.captureException(error, { tags: { cron_scan: "bookkeeper" } });
    log("cron_bookkeeper.scan_failed", "error", { scan: "bookkeeper" });
    await sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "error" });
    return NextResponse.json({ error: "scan_unavailable" }, { status: 503 });
  } finally {
    await flushLogs();
  }
}
