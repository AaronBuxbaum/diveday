import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { rollAllSeriesForward } from "@/db/trips";
import { log } from "@/lib/log";
import { flushLogs } from "@/lib/observability";
import { SERIES_HORIZON_DAYS } from "@/lib/recurrence";

/**
 * A pass is one bounded transaction per still-running series, and each writes
 * at most a handful of rows — a weekly series adds seven dates on the day it
 * crosses the horizon and nothing on the six days either side. 60s is far above
 * the observed tick and still kills a pass that has wedged. Raise it only with
 * evidence from `cron_trip_series.roll_complete`.
 */
export const maxDuration = 60;

/**
 * Sentry Cron Monitor identity for the nightly horizon roll. Separate from the
 * other passes' monitors on purpose: a series that stops being extended is a
 * schedule going quietly empty four months out, which is a different incident
 * with a different urgency from a missed reminder or a missed prune.
 */
const CRON_MONITOR_SLUG =
  process.env.SENTRY_TRIP_SERIES_CRON_MONITOR_SLUG || "diveday-trip-series-roll";

/**
 * Must stay in lockstep with the `crons` entry in vercel.json — Sentry uses it
 * to decide when a check-in is *missing*, which is the whole point of the
 * dead-man's switch. `checkinMargin` is generous because the horizon is
 * `SERIES_HORIZON_DAYS` wide: a roll being a day or two late costs a shop
 * nothing a diver can see.
 */
const CRON_MONITOR_CONFIG = {
  schedule: { type: "crontab", value: "15 3 * * *" },
  checkinMargin: 240,
  maxRuntime: 5,
  timezone: "Etc/UTC",
} as const;

/**
 * Keep every open-ended series' next `SERIES_HORIZON_DAYS` on the board.
 *
 * This is what makes a recurring trip unlimited rather than a batch of dates
 * somebody has to re-schedule every season (ADR
 * 20260810-open-ended-recurring-trips). It creates the cadence dates that are
 * missing and nothing else: an instance staff edited, moved, or cancelled is
 * already spoken for, and one they deleted is held open by a skip row, so a
 * pass that runs twice in a night is a no-op the second time.
 *
 * Daily rather than weekly: the roll is cheap and idempotent, and a daily pass
 * means the board's far edge advances by a day at a time instead of arriving in
 * a lump — which is also what keeps a single pass small enough to be boring.
 *
 * Fails closed exactly like the other scheduled routes: `CRON_SECRET` must be
 * configured and presented as a bearer token, or the endpoint answers 503
 * (unconfigured) / 401 (wrong or missing token) and writes nothing. The auth
 * gate runs *before* the Sentry check-in so an unauthorized probe can never
 * tell the monitor the roll happened.
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
    const db = await getDb();
    const summary = await rollAllSeriesForward(db);

    // A series that cannot be rolled is not a transient blip: it has had every
    // instance deleted, or its course was archived under it, and it will fail
    // the same way every night until somebody looks. Named as a warning rather
    // than an error because the shop's existing dates are all still on the
    // board — nothing a diver can see is broken yet.
    if (summary.failures > 0) {
      Sentry.captureMessage("trip series could not be rolled forward", {
        level: "warning",
        tags: { series_failures: String(summary.failures) },
      });
    }

    log("cron_trip_series.roll_complete", "info", {
      horizonDays: SERIES_HORIZON_DAYS,
      seriesConsidered: summary.seriesConsidered,
      seriesExtended: summary.seriesExtended,
      tripsCreated: summary.tripsCreated,
      seriesFailed: summary.failures,
    });

    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: CRON_MONITOR_SLUG,
      status: summary.failures > 0 ? "error" : "ok",
    });

    // Some series rolled and some did not, so the invocation log should agree
    // with Sentry that this run was not clean. The pass is idempotent, so a
    // retry re-attempts only what is still missing.
    return NextResponse.json(summary, { status: summary.failures > 0 ? 500 : 200 });
  } catch (error) {
    // Only reachable before any series is touched — `getDb()` failing to
    // connect or migrate. The check-in still has to be closed out or the
    // monitor would read this as a run that is somehow still in progress.
    Sentry.captureException(error, { tags: { cron_scan: "trip_series_bootstrap" } });
    log("cron_trip_series.roll_failed", "error", { scan: "bootstrap" });
    Sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "error" });
    return NextResponse.json({ error: "roll_unavailable" }, { status: 503 });
  } finally {
    await flushLogs();
  }
}
