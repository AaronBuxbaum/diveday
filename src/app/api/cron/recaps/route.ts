import { getDb } from "@/db/client";
import { sendDueRecaps } from "@/db/recap";
import { cronRoute } from "@/lib/cron-route";
import { RECAP_CRON_CRONTAB } from "@/lib/recap-schedule";

/** Recaps may send a whole returned boat's follow-ups; keep the provider-bound pass bounded. */
export const maxDuration = 300;

/**
 * The post-dive recap pass is hourly so a returned boat's follow-up arrives
 * within an hour of its four-hour floor. The floor remains in `sendDueRecaps`,
 * rather than being inferred from this cadence, and the per-booking delivery
 * row makes reruns safe. A separate monitor from the daily retry drain: their
 * delivery promises differ.
 */
export const GET = cronRoute({
  id: "recaps",
  crontab: RECAP_CRON_CRONTAB,
  slugEnv: "SENTRY_RECAP_CRON_MONITOR_SLUG",
  run: async () => sendDueRecaps(await getDb()),
});
