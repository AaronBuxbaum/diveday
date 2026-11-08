import { getDb } from "@/db/client";
import { BOOKKEEPER_CRON_CRONTAB } from "@/features/bookkeeper";
import { cronRoute } from "@/features/cron-route";
import { nowDate } from "@/lib/clock";
import { sendDueMonthEndEmails } from "./month-end-pass";

/** Many shops can fall due on one 2nd; the files are three reads each. */
export const maxDuration = 300;

/**
 * **The bookkeeper's month-end email, daily on the 2nd and 3rd** (fifth loop,
 * item 35; ADR 20261016-bookkeeper-month-end-email). Each shop with an address
 * gets last month's report, orders and crew sheet once
 * (`sendDueMonthEndEmails`); the 3rd retries a send the 2nd could not make.
 */
export const GET = cronRoute({
  id: "bookkeeper",
  crontab: BOOKKEEPER_CRON_CRONTAB,
  run: async () => sendDueMonthEndEmails(await getDb(), { now: nowDate() }),
});
