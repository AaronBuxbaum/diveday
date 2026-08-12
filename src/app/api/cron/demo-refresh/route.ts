import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SCHEDULE_MIN_RUNWAY_DAYS, refreshCanonicalDemoSchedule } from "@/db/demo-refresh";
import { log } from "@/lib/log";
import { flushLogs } from "@/lib/observability";

/**
 * Most passes are one indexed aggregate and no write at all. The pass that does
 * act deletes and re-inserts the whole demo playground -- a few thousand rows
 * over the pooled connection -- so this matches the reminders cron's ceiling
 * rather than the 60s the read-only passes get by.
 */
export const maxDuration = 300;

/** Separate Sentry monitor from the other crons -- a demo nobody can book from is its own incident. */
const CRON_MONITOR_SLUG =
  process.env.SENTRY_DEMO_REFRESH_CRON_MONITOR_SLUG || "diveday-demo-refresh";

/**
 * Must stay in lockstep with the `crons` entry in vercel.json. `checkinMargin`
 * is generous because the pass only has to act before the board runs out, which
 * `DEMO_SCHEDULE_MIN_RUNWAY_DAYS` leaves three weeks for; `maxRuntime` sits
 * above `maxDuration` so a platform-killed run reads as timed-out rather than
 * still running.
 */
const CRON_MONITOR_CONFIG = {
  schedule: { type: "crontab", value: "45 3 * * *" },
  checkinMargin: 240,
  maxRuntime: 10,
  timezone: "Etc/UTC",
} as const;

/**
 * Keep the canonical demo shop's schedule from aging out from under its seed.
 *
 * The demo's dates are anchored to the instant the database was seeded, and
 * that seed runs exactly once (`src/db/client.ts`). Without this pass the board
 * empties about two months later, and the homepage's "See a diver's booking
 * page" link -- which opens `/s/blue-mantis` -- lands every visitor on "No trips
 * on the books yet". See ADR 20260812-demo-schedule-keeper.
 *
 * Daily rather than weekly, for the same reason the trip-series roll is: the
 * check costs one aggregate query, so running it often is how the restore lands
 * the day the board crosses the threshold instead of up to a week later. The
 * pass is idempotent -- a second run the same night reads a full board and
 * writes nothing.
 *
 * Fails closed exactly like the other scheduled routes: `CRON_SECRET` must be
 * configured and presented as a bearer token, or the endpoint answers 503
 * (unconfigured) / 401 (wrong or missing token) and writes nothing. That gate
 * matters more here than on a read-only pass -- this one can wipe and rebuild a
 * shop -- and it runs *before* the Sentry check-in so an unauthorized probe can
 * never tell the monitor the pass happened.
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
    const summary = await refreshCanonicalDemoSchedule(db);

    log("cron_demo_refresh.pass_complete", "info", {
      minRunwayDays: DEMO_SCHEDULE_MIN_RUNWAY_DAYS,
      // The runway *before* this pass acted: read over time it says how fast
      // the demo board is consumed, and a value that never falls means the
      // restore is running but the threshold is never being crossed.
      runwayDays: summary.runwayDays,
      refreshed: summary.refreshed,
      // A database with no canonical demo is a legitimate state (one seeded
      // around an existing shop), not a failure -- but it is worth being able
      // to tell apart from a pass that found a healthy board.
      demoShopFound: summary.found,
    });

    Sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "ok" });
    return NextResponse.json(summary);
  } catch (error) {
    // Either the database was unreachable or the restore itself failed. The
    // restore runs in one transaction, so the demo is whatever it was before
    // this pass -- an aging board, not a half-wiped shop -- and tomorrow's tick
    // re-attempts it.
    Sentry.captureException(error, { tags: { cron_pass: "demo_refresh" } });
    log("cron_demo_refresh.pass_failed", "error", {});
    Sentry.captureCheckIn({ checkInId, monitorSlug: CRON_MONITOR_SLUG, status: "error" });
    return NextResponse.json({ error: "refresh_unavailable" }, { status: 503 });
  } finally {
    await flushLogs();
  }
}
