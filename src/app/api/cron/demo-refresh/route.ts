import { getDb } from "@/db/client";
import { DEMO_SCHEDULE_MIN_RUNWAY_DAYS, refreshCanonicalDemoSchedule } from "@/db/demo-refresh";
import { cronRoute } from "@/features/platform/cron-route";

/**
 * Most passes are one indexed aggregate and no write at all. The pass that does
 * act deletes and re-inserts the whole demo playground -- a few thousand rows
 * over the pooled connection -- so this matches the reminders cron's ceiling
 * rather than the 60s the read-only passes get by.
 */
export const maxDuration = 300;

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
export const GET = cronRoute({
  id: "demo-refresh",
  // 09:08 UTC is 4:08 to 5:08 AM in the demo shop's zone, before its day: the
  // today pass moves a boat onto `demoTodayDepartureStart(now)`, and run in the
  // shop's evening (it was 03:45 UTC) that boat sailed at 11:46 PM (issue
  // #2440). The minute is the one after the usage pass, so the 09:xx dailies
  // wake the database once (`src/lib/cron-schedule.test.ts`). `checkinMargin`
  // is generous because the pass only has to act before the board runs out,
  // which `DEMO_SCHEDULE_MIN_RUNWAY_DAYS` leaves three weeks for.
  crontab: "8 9 * * *",
  checkinMargin: 240,
  maxRuntime: 10,
  run: async () => {
    const db = await getDb();
    const summary = await refreshCanonicalDemoSchedule(db);
    return { ...summary, minRunwayDays: DEMO_SCHEDULE_MIN_RUNWAY_DAYS };
  },
});
