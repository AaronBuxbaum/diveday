import type { AppDb } from "@/db/client";
import { sendDueCrewNotices } from "@/db/crew-notices";
import { sendMissingDiverAlerts } from "@/db/missing-diver-alerts";
import { drainNotificationRetries } from "@/db/notifications";
import { bringDemoBoatsAtSeaHome } from "@/db/seed";
import { sendTrailingDeskPings } from "@/features/desk-pings";
import { sendDueRecaps } from "@/features/recap";
import { sendDueReminders } from "@/features/reminders";
import { sendStaleRollCallAlerts } from "@/features/roll-call-alerts";
import { sendSeatSoldAlerts } from "@/features/seat-sold-alerts";
import { reportScrubbedError } from "@/features/sentry-server";
import { sendDueServiceReminders } from "@/features/work-order-follow-up";
import { marineLifeNamesIn } from "@/i18n/marine-life-labels";
import { errorClassToken, errorCodeToken } from "@/lib/error-token";
import { log } from "@/lib/log";
import { sweepMinimumSeats } from "./minimum-seats";

/**
 * **The shop tick: every shop cadence, once an hour** (issue #2715).
 *
 * Seven hourly routes used to wake at seven minutes of every hour, each with
 * its own monitor, its own `maxDuration` and its own crontab constant tested
 * against vercel.json. Each was the same promise: a shop's work that a fixed
 * UTC hour cannot serve, decided per shop in the shop's own day (the send
 * window, the desk's hours, a departure's printed decision time). They are now
 * scans of one tick. Platform cadences (retention, backups, the daily retry
 * drain, integrations) stay UTC routes of their own.
 *
 * Every scan is isolated: a throw is reported to Sentry under its own
 * `cron_scan` tag, logged as `cron_shop_tick.scan_failed` with the scan's
 * name, and answered as `null`, so a broken recap pass never costs a diver a
 * reminder or a shop its missing-diver alert. The monitor's check-in turns to
 * error when any scan failed, or when a filed missing-diver report is still
 * untold half an hour after filing (`shopTickIsHealthy`).
 *
 * Every scan reads one instant, so one tick is one moment.
 */
export const SHOP_TICK_SCANS = [
  "demo-boats-at-sea",
  "minimum-seats",
  "trip-reminders",
  "held-sends",
  "service-reminders",
  "recaps",
  "crew-notices",
  "roll-call-alerts",
  "missing-diver-alerts",
  "desk-pings",
  "seat-sold-alerts",
] as const;

export type ShopTickScan = (typeof SHOP_TICK_SCANS)[number];

export function isShopTickScan(value: string): value is ShopTickScan {
  return (SHOP_TICK_SCANS as readonly string[]).includes(value);
}

const RUNS = {
  // Brings every demo shop's boat at sea home once she is past her return
  // (issue 2917): a count left open read as divers lost at sea. Demo shops
  // only, and a boat already home is left alone. It runs before the others so
  // the roll-call alert never reads a demo boat as overdue.
  "demo-boats-at-sea": (db, now) => bringDemoBoatsAtSeaHome(db, now),
  // A departure's minimum-head-count decision, at the moment printed on the
  // booking page, to within the hour (ADR 20260813-minimum-head-count-departures).
  "minimum-seats": (db, now) => sweepMinimumSeats(db, now),
  // Pre-trip reminders inside each shop's own waking hours (issue #697).
  "trip-reminders": (db, now) => sendDueReminders(db, { now }),
  // Held sends whose client never came back (ADR 20260906-before-you-ask, decision 2).
  // The one send queue's held arm alone (issue #2730); its sealed retries stay
  // on the daily drain, whose backoff is counted in daily ticks.
  "held-sends": async (db, now) =>
    (await drainNotificationRetries(db, { now, scope: "held" })).held,
  // A customer's own gear coming due for service (ADR 20261008-work-order-follow-up).
  "service-reminders": (db, now) => sendDueServiceReminders(db, { now }),
  // The post-dive recap, never before four hours, normally within an hour after.
  recaps: (db, now) => sendDueRecaps(db, { marineLifeNamesIn, now }),
  // Crew hear about their boats (ADR 20261009-crew-hear-about-their-boats).
  "crew-notices": (db, now) => sendDueCrewNotices(db, { now }),
  // An after-dive count still open after the boat was due back.
  "roll-call-alerts": (db, now) => sendStaleRollCallAlerts(db, { now }),
  // The missing-diver alert's retry (H-20261016-missing-diver-report-alerts).
  "missing-diver-alerts": (db, now) => sendMissingDiverAlerts(db, { now }),
  // The after-hours desk ping's trailing catch-up (#2311).
  "desk-pings": (db, now) => sendTrailingDeskPings(db, { now }),
  // The hourly seat-sold email to the desk, for a shop that switched it on (loop 5, row 8).
  "seat-sold-alerts": (db, now) => sendSeatSoldAlerts(db, { now }),
} satisfies Record<ShopTickScan, (db: AppDb, now: Date) => Promise<unknown>>;

export type ShopTickSummary = {
  [Scan in ShopTickScan]?: Awaited<ReturnType<(typeof RUNS)[Scan]>> | null;
};

async function runScan<Scan extends ShopTickScan>(
  scan: Scan,
  db: AppDb,
  now: Date,
): Promise<Awaited<ReturnType<(typeof RUNS)[Scan]>> | null> {
  try {
    return (await RUNS[scan](db, now)) as Awaited<ReturnType<(typeof RUNS)[Scan]>>;
  } catch (error) {
    // Scrubbed: a database or provider error message can quote a diver's name or email.
    await reportScrubbedError(error, {
      name: "CronScanFailed",
      message: "cron scan failed", // i18n-exempt: Sentry event title, never shown to a person
      tags: { cron_scan: scan.replaceAll("-", "_") },
    });
    log("cron_shop_tick.scan_failed", "error", {
      scan,
      errorClass: errorClassToken(error),
      errorCode: errorCodeToken(error),
    });
    return null;
  }
}

/**
 * The scans that run one after another, in this order, before the rest. The
 * demo boats come home before any alert reads a demo boat as overdue. The
 * minimum-head-count decision commits before the reminders read the day, so a
 * diver whose departure was just cancelled is never also told "see you
 * tomorrow" by the same tick.
 */
const RUN_FIRST: readonly ShopTickScan[] = ["demo-boats-at-sea", "minimum-seats"];

/**
 * Runs the named scans (all of them by default) at one instant: the
 * `RUN_FIRST` scans in order, then the rest side by side, each isolated.
 */
export async function runShopTick(
  db: AppDb,
  now: Date,
  scans: readonly ShopTickScan[] = SHOP_TICK_SCANS,
): Promise<ShopTickSummary> {
  const summary: ShopTickSummary = {};
  const record = async <Scan extends ShopTickScan>(scan: Scan) => {
    (summary as Record<Scan, unknown>)[scan] = await runScan(scan, db, now);
  };
  for (const scan of RUN_FIRST) if (scans.includes(scan)) await record(scan);
  await Promise.all(scans.filter((scan) => !RUN_FIRST.includes(scan)).map(record));
  return summary;
}

/**
 * Whether the tick did its work: every scan it ran answered, and no filed
 * missing-diver report is still untold half an hour after filing. A false here
 * is the monitor's error, so someone is paged.
 */
export function shopTickIsHealthy(summary: ShopTickSummary): boolean {
  const ran = Object.values(summary);
  if (ran.some((result) => result === null)) return false;
  return (summary["missing-diver-alerts"]?.overdue ?? 0) === 0;
}
