import { getDb } from "@/db/client";
import { sendDueWeeklyDigests } from "@/features/weekly-digest";
import { nowDate } from "@/lib/clock";
import { cronRoute } from "@/lib/cron-route";
import { WEEKLY_DIGEST_CRON_CRONTAB, weeklyDigestMayBeDueSomewhere } from "@/lib/weekly-digest";

/** A Monday morning can fall due for many shops in one pass. */
export const maxDuration = 300;

/**
 * **The Monday email pass, hourly** (market audit item 51). Its own monitor:
 * a weekly promise on an hourly cadence, Sunday to Tuesday UTC.
 *
 * Hourly for the trip-reminder pass's reason: one fixed UTC hour is Monday
 * breakfast in one longitude and Sunday night in another. Each pass sends for
 * the shops whose own calendar says it is Monday inside the sending hours, and
 * the per-person, per-week claim in `weekly_digest_sends` makes every later
 * pass that day, and any re-run, a no-op.
 *
 * Scheduled Sunday to Tuesday UTC only, and an hour of those three days that
 * is outside every zone's Monday sending hours checks in and stops before the
 * database (`weeklyDigestMayBeDueSomewhere`): no shop can be due, so there is
 * nothing to read.
 */
export const GET = cronRoute({
  id: "weekly-digest",
  crontab: WEEKLY_DIGEST_CRON_CRONTAB,
  run: async () => {
    if (!weeklyDigestMayBeDueSomewhere(nowDate())) return { skipped: "no_shop_in_its_monday" };
    return sendDueWeeklyDigests(await getDb());
  },
});
