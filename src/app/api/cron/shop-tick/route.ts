import { getDb } from "@/db/client";
import {
  isShopTickScan,
  runShopTick,
  SHOP_TICK_SCANS,
  shopTickIsHealthy,
} from "@/features/shop-tick";
import { nowDate } from "@/lib/clock";
import { cronRoute } from "@/lib/cron-route";
import { SHOP_TICK_CRONTAB } from "@/lib/cron-schedule";

/** A whole boat's reminders or recaps can come due at once; keep the provider-bound pass bounded. */
export const maxDuration = 300;

/**
 * **Every shop cadence, hourly** (issue #2715): one route, one monitor, the
 * scans in `src/features/shop-tick`. Each scan is isolated, and a failed one
 * turns the check-in to error without costing the others their pass.
 *
 * `?scan=<name>` (repeatable) runs only those scans, for a rerun by hand or an
 * end-to-end test of one; an unknown name is an error, never a silent full
 * tick.
 */
export const GET = cronRoute({
  id: "shop-tick",
  crontab: SHOP_TICK_CRONTAB,
  run: async (request) => {
    const named = new URL(request.url).searchParams.getAll("scan");
    const unknown = named.filter((scan) => !isShopTickScan(scan));
    if (unknown.length > 0) throw new Error(`unknown shop-tick scan: ${unknown.join(", ")}`);
    const scans = named.length > 0 ? named.filter(isShopTickScan) : SHOP_TICK_SCANS;
    return runShopTick(await getDb(), nowDate(), scans);
  },
  healthy: shopTickIsHealthy,
});
