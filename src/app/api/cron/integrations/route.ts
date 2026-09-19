import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import {
  dispatchDueIntegrationDeliveries,
  INTEGRATIONS_CRON_CRONTAB,
} from "@/features/integrations";
import { log } from "@/lib/log";
import { flushLogs } from "@/lib/observability";

export const maxDuration = 300;

/**
 * Its own Sentry monitor, like every other scheduled route.
 *
 * This was the one cron of eleven with no check-in at all: the route captured
 * exceptions, so a pass that *ran and threw* was visible, and a pass that never
 * ran was not. That is the wrong half to cover. The outbox is drained only
 * here, so a cron Vercel silently stopped invoking means deliveries to a shop's
 * Shopify, QuickBooks, Xero or Zapier stop retrying and nothing anywhere says
 * so — the integration simply goes quiet, which is indistinguishable from
 * having nothing to send.
 *
 * It matters more since ADR 20260919-health-check-does-not-wake-the-database,
 * which moved database liveness onto the cron monitors' dead-man's switches on
 * the stated grounds that every cron has one. This route is what made that
 * sentence false.
 */
const CRON_MONITOR_SLUG =
  process.env.SENTRY_INTEGRATIONS_CRON_MONITOR_SLUG || "diveday-integrations";

/**
 * Must stay in lockstep with the `crons` entry in vercel.json — Sentry uses it
 * to decide when a check-in is *missing*, which is the whole point of the
 * dead-man's switch. The value comes from the dispatcher rather than being
 * restated here, and `src/features/integrations/dispatcher.test.ts` asserts it
 * against the deployed schedule.
 *
 * `checkinMargin` matches the other sub-daily passes: twenty minutes late on a
 * half-hourly drain is worth a look, and anything tighter would page on a slow
 * provider rather than on a cron that stopped. `maxRuntime` sits above
 * `maxDuration` so a run the platform killed reads as timed-out rather than as
 * still running.
 */
const CRON_MONITOR_CONFIG = {
  schedule: { type: "crontab", value: INTEGRATIONS_CRON_CRONTAB },
  checkinMargin: 20,
  maxRuntime: 10,
  timezone: "Etc/UTC",
} as const;

/**
 * Drain the provider-neutral integration outbox. The bearer gate runs first —
 * before the Sentry check-in, like the other scheduled routes, so an
 * unauthorized probe can never tell the monitor the drain happened.
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
    const summary = await dispatchDueIntegrationDeliveries(await getDb(), { limit: 50 });
    log("cron_integrations.scan_complete", "info", summary);
    Sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "ok" });
    return NextResponse.json(summary);
  } catch (error) {
    Sentry.captureException(error, { tags: { cron_scan: "integrations" } });
    log("cron_integrations.scan_failed", "error", { scan: "integrations" });
    Sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "error" });
    return NextResponse.json({ error: "scan_unavailable" }, { status: 503 });
  } finally {
    await flushLogs();
  }
}
