import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { sendDueReminders } from "@/db/reminders";
import { log } from "@/lib/log";
import { flushLogs } from "@/lib/observability";
import { TRIP_REMINDER_CRON_CRONTAB } from "@/lib/reminders";

/** A whole boat's reminders can come due at once; keep the provider-bound pass bounded. */
export const maxDuration = 300;

/** Its own monitor, like the recap pass: a different cadence and a different promise. */
const CRON_MONITOR_SLUG =
  process.env.SENTRY_TRIP_REMINDER_CRON_MONITOR_SLUG || "diveday-trip-reminders";
const CRON_MONITOR_CONFIG = {
  schedule: { type: "crontab", value: TRIP_REMINDER_CRON_CRONTAB },
  checkinMargin: 20,
  maxRuntime: 10,
  timezone: "Etc/UTC",
} as const;

/**
 * **The pre-trip reminder pass, hourly.**
 *
 * It used to ride the daily 14:00 UTC tick, which is 10am in Florida and 03:00
 * in Fiji — so every shop in the signup picker's own Asia-Pacific group texted
 * its divers in the middle of the night, every day (issue #697). A fixed UTC
 * hour cannot serve more than one longitude.
 *
 * Hourly plus the shop's own send window (`src/lib/send-window.ts`) does: every
 * longitude gets passes inside its own daytime, and `sendDueReminders` decides
 * whether this is one of them. Reruns are safe — a cadence bucket is hours wide
 * and the per-booking delivery row makes each cadence send at most once.
 *
 * Separate from `/api/cron/reminders` rather than making that hourly: its other
 * five scans are durable-retry drains whose backoff bounds derive from
 * `DAILY_TICK_CRONTAB` (OPS-6), and moving that cadence would move a retry
 * window this has no business touching.
 *
 * A pass can now report a cadence that came due and was not sent: the rhythm
 * rule table (`TRIP_REMINDER_RHYTHM`, issue #1177) holds the 7-day nudge back
 * from a diver with nothing left undone, and the summary counts those as
 * `settled` rather than as sent, skipped or failed.
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
    const summary = await sendDueReminders(await getDb());
    log("cron_trip_reminders.scan_complete", "info", summary);
    Sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "ok" });
    return NextResponse.json(summary);
  } catch (error) {
    Sentry.captureException(error, { tags: { cron_scan: "trip_reminders" } });
    log("cron_trip_reminders.scan_failed", "error", { scan: "trip_reminders" });
    Sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "error" });
    return NextResponse.json({ error: "scan_unavailable" }, { status: 503 });
  } finally {
    await flushLogs();
  }
}
